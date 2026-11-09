import { z } from "zod";

/**
 * Shared validation — used by both the Server Action wrapper (server) and the
 * client forms (react-hook-form) so the rules are identical on both sides.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const emailSchema = z.email({
  message: "auth.errorInvalidEmail",
});

/** Bangladeshi mobile numbers, with or without the country code. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?880|0)1[3-9]\d{8}$/, { message: "auth.errorInvalidPhone" });

/**
 * Bangladeshi mobile → E.164 (`01712…` → `+8801712…`). Better Auth's phone
 * plugin validates and stores numbers in this form, so every client call
 * must send it — otherwise local-format numbers are rejected as invalid.
 */
export function toBdE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("880")) return `+${digits}`;
  if (digits.startsWith("01")) return `+880${digits.slice(1)}`;
  if (digits.startsWith("1")) return `+880${digits}`;
  return raw.trim();
}

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { message: "auth.errorInvalidCode" });

export const signInEmailSchema = z.object({ email: emailSchema });
export const signInPhoneSchema = z.object({ phone: phoneSchema });

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const interestsStepSchema = z.object({
  interestIds: z
    .array(z.coerce.number().int().positive())
    .min(3, { message: "onboarding.interests.minError" })
    .max(8, { message: "onboarding.interests.maxError" }),
});

export const areaStepSchema = z.object({
  areaId: z.coerce.number().int().positive({ message: "onboarding.area.choose" }),
});

export const SLOTS = ["morning", "afternoon", "evening"] as const;
export type Slot = (typeof SLOTS)[number];

export const availabilityStepSchema = z.object({
  slots: z
    .array(
      z.object({
        weekday: z.coerce.number().int().min(0).max(6),
        slot: z.enum(SLOTS),
      }),
    )
    .min(1, { message: "onboarding.availability.error" }),
});

export const preferencesStepSchema = z.object({
  groupSize: z.enum(["small", "medium"]).default("small"),
  womenOnly: z
    .union([z.boolean(), z.literal("true"), z.literal("on"), z.literal("")])
    .transform((v) => v === true || v === "true" || v === "on"),
  mode: z.enum(["offline", "online", "both"]).default("both"),
  language: z.enum(["bn", "en", "both"]).default("both"),
  bio: z.string().trim().max(400).optional().default(""),
  // Cloudinary URL from `uploadFile`; ownership is checked in the action.
  avatarUrl: z.string().trim().max(500).optional().default(""),
});

export const guidelinesStepSchema = z.object({
  accepted: z
    .union([z.literal("true"), z.literal("on"), z.literal(""), z.boolean()])
    .transform((v) => v === true || v === "true" || v === "on")
    .refine((v) => v, { message: "onboarding.guidelines.acceptError" }),
});

export const phoneVerifySchema = z.object({ phone: phoneSchema });

// ---------------------------------------------------------------------------
// Profile & settings
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  gender: z.enum(["male", "female", "other"]).optional().or(z.literal("")),
  birthYear: z.coerce
    .number()
    .int()
    .min(1950)
    .max(2010)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  bio: z.string().trim().max(400).optional().default(""),
  avatarUrl: z.string().trim().max(500).optional().default(""),
  areaId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const settingsSchema = z.object({
  locale: z.enum(["en", "bn"]),
});

/**
 * Form checkboxes arrive as "true"/"on" or are omitted entirely. Note this is
 * deliberately *not* `z.coerce.boolean()` — that turns the string "false"
 * into `true`, which would make every preference impossible to switch off.
 */
const checkboxValue = z
  .union([
    z.literal("true"),
    z.literal("false"),
    z.literal("on"),
    z.literal(""),
    z.boolean(),
  ])
  .transform((v) => v === true || v === "true" || v === "on");

export const notificationPrefsSchema = z.object({
  emailCircleInvites: checkboxValue.optional().default(true),
  emailActivityReminders: checkboxValue.optional().default(true),
  emailFeedbackRequests: checkboxValue.optional().default(true),
  emailGeneral: checkboxValue.optional().default(false),
  inAppNotifications: checkboxValue.optional().default(true),
});

/** Who may see a member's full profile. */
export const PROFILE_VISIBILITIES = ["members", "circles", "hidden"] as const;
/** How precisely a member's home area is shown to other people. */
export const AREA_VISIBILITIES = ["exact", "zone", "hidden"] as const;

export const privacySchema = z.object({
  profileVisibility: z.enum(PROFILE_VISIBILITIES).default("members"),
  showGender: checkboxValue.optional().default(true),
  showAge: checkboxValue.optional().default(true),
  areaVisibility: z.enum(AREA_VISIBILITIES).default("zone"),
});

export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE", { message: "settings.deleteError" }),
});

// ---------------------------------------------------------------------------
// Activities & RSVP
// ---------------------------------------------------------------------------

export const activityFormSchema = z
  .object({
    title: z.string().trim().min(6, "Too short").max(120),
    description: z.string().trim().min(20, "Tell people a bit more").max(3000),
    categoryInterestId: z.coerce.number().int().positive(),
    venueId: z.coerce.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time"),
    capacity: z.coerce.number().int().min(2).max(60),
    costBdt: z.coerce.number().int().min(0).max(100000).default(0),
    womenOnly: z
      .union([z.literal("true"), z.literal("on"), z.literal(""), z.boolean()])
      .transform((v) => v === true || v === "true" || v === "on"),
    imageUrl: z.string().trim().max(500).optional().default(""),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

export const updateActivitySchema = activityFormSchema.extend({
  id: z.coerce.number().int().positive(),
  status: z.enum(["pending", "approved", "cancelled", "completed"]).optional(),
});

export const rsvpSchema = z.object({
  activityId: z.coerce.number().int().positive(),
  action: z.enum(["join", "cancel", "waitlist", "leave-waitlist"]),
});

export const checkinSchema = z.object({
  activityId: z.coerce.number().int().positive(),
  userId: z.string().min(1),
  checkedIn: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "true"),
});

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/** Optional upload id from a form ("" / missing → undefined). */
const optionalId = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .or(z.literal("").transform(() => undefined));

export const hostApplicationSchema = z.object({
  motivation: z.string().trim().min(30, "A little more detail, please").max(2000),
  experience: z.string().trim().max(2000).optional().default(""),
  attachmentUploadId: optionalId,
});

// ---------------------------------------------------------------------------
// Circles, polls, messages
// ---------------------------------------------------------------------------

export const circleMessageSchema = z.object({
  circleId: z.coerce.number().int().positive(),
  body: z.string().trim().min(1, "Empty message").max(800),
});

export const pollVoteSchema = z.object({
  pollId: z.coerce.number().int().positive(),
  optionIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const createPollSchema = z.object({
  circleId: z.coerce.number().int().positive(),
  title: z.string().trim().min(4).max(120),
  options: z
    .array(z.object({ label: z.string().trim().min(3).max(80) }))
    .min(2)
    .max(6),
});

export const circleRequestSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export const leaveCircleSchema = z.object({
  circleId: z.coerce.number().int().positive(),
});

export const circleInviteSchema = z.object({
  circleId: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export const reportSchema = z.object({
  targetType: z.enum(["user", "activity", "message"]),
  targetId: z.string().min(1),
  reason: z.enum(["spam", "harassment", "inappropriate", "safety", "other"]),
  details: z.string().trim().max(1000).optional().default(""),
  attachmentUploadId: optionalId,
});

export const blockSchema = z.object({
  userId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export const feedbackSchema = z.object({
  activityId: z.coerce.number().int().positive(),
  comfortable: z.coerce.number().int().min(1).max(5),
  wantToMeetAgain: z
    .union([z.literal("true"), z.literal("false"), z.literal(""), z.boolean()])
    .transform((v) => v === true || v === "true"),
  madeConnection: z
    .union([z.literal("true"), z.literal("false"), z.literal(""), z.boolean()])
    .transform((v) => v === true || v === "true"),
  note: z.string().trim().max(1000).optional().default(""),
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminUserUpdateSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(["suspend", "restore", "member", "host", "admin"]),
});

export const circleRequestResolutionSchema = z.object({
  requestId: z.coerce.number().int().positive(),
});

export const reportResolutionSchema = z.object({
  reportId: z.coerce.number().int().positive(),
  status: z.enum(["actioned", "dismissed"]),
  note: z.string().trim().max(500).optional().default(""),
});

export const moderateMessageSchema = z.object({
  messageId: z.coerce.number().int().positive(),
});

export const hostApplicationReviewSchema = z.object({
  applicationId: z.coerce.number().int().positive(),
  status: z.enum(["approved", "rejected"]),
});

export const venueSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2).max(120),
  areaId: z.coerce.number().int().positive(),
  address: z.string().trim().min(5).max(300),
  mapUrl: z.string().trim().max(300).optional().default(""),
  imageUrl: z.string().trim().max(500).optional().default(""),
  type: z.enum(["cafe", "park", "sports", "coworking", "other"]).default("cafe"),
  isPublic: z
    .union([z.literal("true"), z.literal("on"), z.literal(""), z.boolean()])
    .transform((v) => v === true || v === "true" || v === "on"),
  approved: z
    .union([z.literal("true"), z.literal("on"), z.literal(""), z.boolean()])
    .transform((v) => v === true || v === "true" || v === "on"),
});

export const activityReviewSchema = z.object({
  activityId: z.coerce.number().int().positive(),
  action: z.enum(["approve", "reject", "cancel", "complete"]),
});

export type ActivityFormInput = z.infer<typeof activityFormSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type PrivacyInput = z.infer<typeof privacySchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type ReportInput = z.infer<typeof reportSchema>;

// ---------------------------------------------------------------------------
// Admin: locations
// ---------------------------------------------------------------------------

export const locationCreateSchema = z.object({
  parentId: z.coerce.number().int().positive(),
  level: z.enum([
    "district",
    "city_corporation",
    "upazila",
    "thana",
    "ward",
    "union",
    "area",
    "village",
  ]),
  nameEn: z.string().trim().min(2).max(80),
  nameBn: z.string().trim().min(1).max(80),
});

export const locationUpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  nameEn: z.string().trim().min(2).max(80).optional(),
  nameBn: z.string().trim().min(1).max(80).optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
});
