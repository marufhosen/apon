import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * APON — data model.
 *
 * Naming convention: camelCase TypeScript properties, snake_case SQL columns.
 * The `users`, `sessions`, `accounts`, `verifications` and `rate_limits` tables
 * are Best-effort mirrors of Better Auth's core schema plus our own profile
 * columns; Better Auth reads/writes them through the Drizzle adapter.
 *
 * Enums are stored as `text` columns and validated by Zod in `lib/validations`.
 * This keeps migrations simple and lets seed data evolve without enum churn.
 */

const tz = { withTimezone: true } as const;
const createdAt = () => timestamp("created_at", tz).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", tz).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Better Auth core tables
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),

    // Added by the `username` plugin: stored lower-case (unique), shown as typed.
    username: text("username").unique(),
    displayUsername: text("display_username"),

    // Added by the `phoneNumber` plugin.
    phoneNumber: text("phone_number"),
    phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),

    // Profile
    gender: text("gender"),
    birthYear: integer("birth_year"),
    areaId: integer("area_id"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),

    // Privacy: who may see the full profile, and whether sensitive fields are
    // shown at all. Defaults are deliberately conservative but keep profile
    // links from activities and circles usable for signed-in members.
    profileVisibility: text("profile_visibility").notNull().default("members"), // members | circles | hidden
    showGender: boolean("show_gender").notNull().default(true),
    showAge: boolean("show_age").notNull().default(true),
    areaVisibility: text("area_visibility").notNull().default("zone"), // exact | zone | hidden

    // App-level columns
    role: text("role").notNull().default("member"), // member | host | admin
    locale: text("locale").notNull().default("en"), // en | bn
    status: text("status").notNull().default("active"), // active | suspended
    onboardedAt: timestamp("onboarded_at", tz),
    guidelinesAcceptedAt: timestamp("guidelines_accepted_at", tz),
    deletedAt: timestamp("deleted_at", tz),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_phone_unique").on(t.phoneNumber),
    index("users_area_idx").on(t.areaId),
    index("users_status_idx").on(t.status),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", tz).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Better Auth's DB-backed rate limiter (`rateLimit.storage: "db"`). */
export const rateLimitBuckets = pgTable("rate_limits", {
  id: text("id"),
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  lastRequest: bigint("last_request", { mode: "number" }).notNull().default(0),
});

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/**
 * Every place in Bangladesh, as one adjacency-list tree (see `lib/geo`):
 *
 *   division → district → upazila → union → village
 *                       → city_corporation → thana → area
 *                                          → ward
 *
 * Users, venues and activities point at any node. `ancestorIds` (root first)
 * makes "everything inside Dhaka division" a single indexed lookup, and
 * `zone` is the matching cluster a node belongs to (inherited by children).
 */
export const areas = pgTable(
  "areas",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameBn: text("name_bn").notNull(),
    /** division | district | city_corporation | upazila | thana | ward | union | area | village */
    level: text("level").notNull().default("area"),
    parentId: integer("parent_id").references((): AnyPgColumn => areas.id, {
      onDelete: "restrict",
    }),
    /** Ids of every ancestor, root (division) first. Excludes the node itself. */
    ancestorIds: integer("ancestor_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** Source reference, e.g. `upazila:123` from the BBS-derived dataset. */
    code: text("code"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    isActive: boolean("is_active").notNull().default(true),
    /** Matching cluster (e.g. "dhanmondi", "dhaka-savar"). */
    zone: text("zone").notNull(),
    zoneLabelEn: text("zone_label_en").notNull(),
    zoneLabelBn: text("zone_label_bn").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("areas_zone_idx").on(t.zone),
    index("areas_parent_idx").on(t.parentId),
    index("areas_level_idx").on(t.level),
    index("areas_ancestors_idx").using("gin", t.ancestorIds),
    index("areas_name_en_idx").on(sql`lower(${t.nameEn})`),
  ],
);

export const interests = pgTable("interests", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameBn: text("name_bn").notNull(),
  icon: text("icon").notNull().default("sparkles"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Profile: interests, availability, preferences, settings
// ---------------------------------------------------------------------------

export const userInterests = pgTable(
  "user_interests",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    interestId: integer("interest_id")
      .notNull()
      .references(() => interests.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("user_interests_unique").on(t.userId, t.interestId),
    index("user_interests_interest_idx").on(t.interestId),
  ],
);

/** 0 = Sunday … 6 = Saturday, matching JS `Date#getDay`. */
export const availability = pgTable(
  "availability",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    slot: text("slot").notNull(), // morning | afternoon | evening
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.weekday, t.slot] }),
    index("availability_weekday_idx").on(t.weekday, t.slot),
  ],
);

export const preferences = pgTable("preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  groupSize: text("group_size").notNull().default("small"), // small | medium
  womenOnly: boolean("women_only").notNull().default(false),
  mode: text("mode").notNull().default("both"), // offline | online | both
  language: text("language").notNull().default("both"), // bn | en | both
  updatedAt: updatedAt(),
});

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailCircleInvites: boolean("email_circle_invites").notNull().default(true),
  emailActivityReminders: boolean("email_activity_reminders").notNull().default(true),
  emailFeedbackRequests: boolean("email_feedback_requests").notNull().default(true),
  emailGeneral: boolean("email_general").notNull().default(false),
  inAppNotifications: boolean("in_app_notifications").notNull().default(true),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

export const circles = pgTable(
  "circles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    zone: text("zone").notNull(),
    status: text("status").notNull().default("forming"), // forming | active | archived
    womenOnly: boolean("women_only").notNull().default(false),
    /** "system" when created by the matching script, otherwise the host id. */
    createdBy: text("created_by").notNull().default("system"),
    matchedAt: timestamp("matched_at", tz),
    deletedAt: timestamp("deleted_at", tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("circles_status_idx").on(t.status), index("circles_zone_idx").on(t.zone)],
);

export const circleMembers = pgTable(
  "circle_members",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // member | host
    status: text("status").notNull().default("invited"), // invited | active | left | declined
    joinedAt: timestamp("joined_at", tz),
    leftAt: timestamp("left_at", tz),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("circle_members_unique").on(t.circleId, t.userId),
    index("circle_members_user_idx").on(t.userId),
    index("circle_members_status_idx").on(t.status),
  ],
);

export const circleMessages = pgTable(
  "circle_messages",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    hiddenAt: timestamp("hidden_at", tz),
    createdAt: createdAt(),
  },
  (t) => [index("circle_messages_circle_idx").on(t.circleId, t.createdAt)],
);

export const circleRequests = pgTable("circle_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason"),
  status: text("status").notNull().default("open"), // open | handled
  createdAt: createdAt(),
});

export const polls = pgTable(
  "polls",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"), // open | closed
    closesAt: timestamp("closes_at", tz),
    createdAt: createdAt(),
  },
  (t) => [index("polls_circle_idx").on(t.circleId)],
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: serial("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    startsAt: timestamp("starts_at", tz),
    endsAt: timestamp("ends_at", tz),
    createdAt: createdAt(),
  },
  (t) => [index("poll_options_poll_idx").on(t.pollId)],
);

export const pollVotes = pgTable(
  "poll_votes",
  {
    id: serial("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("poll_votes_unique").on(t.pollId, t.userId, t.optionId),
    index("poll_votes_option_idx").on(t.optionId),
  ],
);

// ---------------------------------------------------------------------------
// Uploads (Cloudinary)
// ---------------------------------------------------------------------------

/**
 * Every file a user uploaded to Cloudinary. Profile/activity/venue images and
 * report/host-application attachments may only reference rows owned by the
 * person saving them, so arbitrary external URLs can't be injected.
 */
export const uploads = pgTable(
  "uploads",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** avatar | activity_cover | venue_photo | report_evidence | host_document */
    purpose: text("purpose").notNull(),
    publicId: text("public_id").notNull().unique(),
    resourceType: text("resource_type").notNull(), // image | raw
    deliveryType: text("delivery_type").notNull(), // upload (public) | authenticated (private)
    format: text("format").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** CDN URL for public assets; private ones are only reachable via signed links. */
    secureUrl: text("secure_url").notNull(),
    originalName: text("original_name").notNull(),
    deletedAt: timestamp("deleted_at", tz),
    createdAt: createdAt(),
  },
  (t) => [
    index("uploads_owner_idx").on(t.ownerId, t.purpose),
    index("uploads_url_idx").on(t.secureUrl),
  ],
);

// ---------------------------------------------------------------------------
// Venues & activities
// ---------------------------------------------------------------------------

export const venues = pgTable(
  "venues",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    areaId: integer("area_id")
      .notNull()
      .references(() => areas.id),
    address: text("address").notNull(),
    mapUrl: text("map_url"),
    /** Cloudinary photo (see `uploads`). */
    imageUrl: text("image_url"),
    type: text("type").notNull().default("cafe"), // cafe | park | sports | coworking | other
    isPublic: boolean("is_public").notNull().default(true),
    approved: boolean("approved").notNull().default(false),
    deletedAt: timestamp("deleted_at", tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("venues_area_idx").on(t.areaId),
    index("venues_approved_idx").on(t.approved),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => users.id),
    circleId: integer("circle_id").references(() => circles.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    categoryInterestId: integer("category_interest_id").references(() => interests.id, {
      onDelete: "set null",
    }),
    venueId: integer("venue_id").references(() => venues.id, { onDelete: "set null" }),
    /** Denormalised from the venue — the main filter/index axis. */
    areaId: integer("area_id").references(() => areas.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", tz).notNull(),
    endsAt: timestamp("ends_at", tz).notNull(),
    capacity: integer("capacity").notNull().default(12),
    costBdt: integer("cost_bdt").notNull().default(0),
    imageUrl: text("image_url"),
    womenOnly: boolean("women_only").notNull().default(false),
    status: text("status").notNull().default("pending"), // pending | approved | cancelled | completed
    cancellationReason: text("cancellation_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activities_starts_idx").on(t.startsAt),
    index("activities_status_starts_idx").on(t.status, t.startsAt),
    index("activities_area_idx").on(t.areaId),
    index("activities_venue_idx").on(t.venueId),
    index("activities_host_idx").on(t.hostId),
  ],
);

export const rsvps = pgTable(
  "rsvps",
  {
    id: serial("id").primaryKey(),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("going"), // going | waitlist | cancelled
    checkedIn: boolean("checked_in").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rsvps_unique").on(t.activityId, t.userId),
    index("rsvps_activity_idx").on(t.activityId),
    index("rsvps_user_idx").on(t.userId),
  ],
);

export const hostApplications = pgTable(
  "host_applications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    motivation: text("motivation").notNull(),
    experience: text("experience"),
    /** Optional supporting document (private Cloudinary asset). */
    attachmentUploadId: integer("attachment_upload_id").references(() => uploads.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", tz),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("host_applications_pending_unique").on(t.userId),
    index("host_applications_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Trust & safety
// ---------------------------------------------------------------------------

export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(), // user | activity | message
    targetId: text("target_id").notNull(), // stored as text so it can hold any id
    reason: text("reason").notNull(),
    details: text("details"),
    /** Optional evidence screenshot/PDF (private Cloudinary asset). */
    attachmentUploadId: integer("attachment_upload_id").references(() => uploads.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("open"), // open | actioned | dismissed
    resolutionNote: text("resolution_note"),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", tz),
    createdAt: createdAt(),
  },
  (t) => [
    index("reports_status_idx").on(t.status),
    index("reports_reporter_idx").on(t.reporterId),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    blockerId: text("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("blocks_unique").on(t.blockerId, t.blockedId),
    index("blocks_blocked_idx").on(t.blockedId),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: integer("activity_id").references(() => activities.id, {
      onDelete: "cascade",
    }),
    circleId: integer("circle_id").references(() => circles.id, { onDelete: "set null" }),
    comfortable: integer("comfortable").notNull(),
    wantToMeetAgain: boolean("want_to_meet_again").notNull(),
    madeConnection: boolean("made_connection").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("feedback_unique").on(t.userId, t.activityId),
    index("feedback_activity_idx").on(t.activityId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", tz),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Relations (for `db.query.*` and `with()` prefetching)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  interests: many(userInterests),
  availability: many(availability),
  preference: many(preferences),
  circleMemberships: many(circleMembers),
  rsvps: many(rsvps),
  notifications: many(notifications),
  hostedActivities: many(activities),
  settings: many(userSettings),
}));

export const areasRelations = relations(areas, ({ many }) => ({
  users: many(users),
  venues: many(venues),
  activities: many(activities),
}));

export const interestsRelations = relations(interests, ({ many }) => ({
  userInterests: many(userInterests),
  activities: many(activities),
}));

export const userInterestsRelations = relations(userInterests, ({ one }) => ({
  user: one(users, { fields: [userInterests.userId], references: [users.id] }),
  interest: one(interests, {
    fields: [userInterests.interestId],
    references: [interests.id],
  }),
}));

export const availabilityRelations = relations(availability, ({ one }) => ({
  user: one(users, { fields: [availability.userId], references: [users.id] }),
}));

export const preferencesRelations = relations(preferences, ({ one }) => ({
  user: one(users, { fields: [preferences.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const circlesRelations = relations(circles, ({ many }) => ({
  members: many(circleMembers),
  messages: many(circleMessages),
  polls: many(polls),
  activities: many(activities),
}));

export const circleMembersRelations = relations(circleMembers, ({ one }) => ({
  circle: one(circles, { fields: [circleMembers.circleId], references: [circles.id] }),
  user: one(users, { fields: [circleMembers.userId], references: [users.id] }),
}));

export const circleMessagesRelations = relations(circleMessages, ({ one }) => ({
  circle: one(circles, { fields: [circleMessages.circleId], references: [circles.id] }),
  user: one(users, { fields: [circleMessages.userId], references: [users.id] }),
}));

export const pollsRelations = relations(polls, ({ one, many }) => ({
  circle: one(circles, { fields: [polls.circleId], references: [circles.id] }),
  options: many(pollOptions),
}));

export const pollOptionsRelations = relations(pollOptions, ({ one, many }) => ({
  poll: one(polls, { fields: [pollOptions.pollId], references: [polls.id] }),
  votes: many(pollVotes),
}));

export const pollVotesRelations = relations(pollVotes, ({ one }) => ({
  poll: one(polls, { fields: [pollVotes.pollId], references: [polls.id] }),
  option: one(pollOptions, {
    fields: [pollVotes.optionId],
    references: [pollOptions.id],
  }),
  user: one(users, { fields: [pollVotes.userId], references: [users.id] }),
}));

export const venuesRelations = relations(venues, ({ one, many }) => ({
  area: one(areas, { fields: [venues.areaId], references: [areas.id] }),
  activities: many(activities),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  host: one(users, { fields: [activities.hostId], references: [users.id] }),
  circle: one(circles, { fields: [activities.circleId], references: [circles.id] }),
  venue: one(venues, { fields: [activities.venueId], references: [venues.id] }),
  area: one(areas, { fields: [activities.areaId], references: [areas.id] }),
  category: one(interests, {
    fields: [activities.categoryInterestId],
    references: [interests.id],
  }),
  rsvps: many(rsvps),
}));

export const rsvpsRelations = relations(rsvps, ({ one }) => ({
  activity: one(activities, { fields: [rsvps.activityId], references: [activities.id] }),
  user: one(users, { fields: [rsvps.userId], references: [users.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterId], references: [users.id] }),
  resolver: one(users, { fields: [reports.resolvedBy], references: [users.id] }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
  blocker: one(users, { fields: [blocks.blockerId], references: [users.id] }),
  blocked: one(users, { fields: [blocks.blockedId], references: [users.id] }),
}));

export const feedbackRelations = relations(feedback, ({ one }) => ({
  user: one(users, { fields: [feedback.userId], references: [users.id] }),
  activity: one(activities, {
    fields: [feedback.activityId],
    references: [activities.id],
  }),
  circle: one(circles, { fields: [feedback.circleId], references: [circles.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Area = typeof areas.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type Interest = typeof interests.$inferSelect;
export type Circle = typeof circles.$inferSelect;
export type CircleMember = typeof circleMembers.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Rsvp = typeof rsvps.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Poll = typeof polls.$inferSelect;
export type PollOption = typeof pollOptions.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
