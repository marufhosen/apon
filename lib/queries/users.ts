import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canViewFullProfile,
  pickVisibleArea,
  type AreaVisibility,
  type ProfileVisibility,
} from "@/lib/privacy";
import {
  accounts,
  areas,
  availability,
  blocks,
  circleMembers,
  circles,
  interests,
  preferences,
  userInterests,
  userSettings,
  users,
} from "@/lib/db/schema";

export type PublicProfile = NonNullable<Awaited<ReturnType<typeof getPublicProfile>>>;

/**
 * Public profile. Contact details (email, phone) are never selected here —
 * the only location data that leaves the server is the area name.
 */
export async function getPublicProfile(profileId: string, viewerId?: string) {
  // Select only profile columns: contact details must never reach this query.
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      gender: users.gender,
      birthYear: users.birthYear,
      role: users.role,
      createdAt: users.createdAt,
      status: users.status,
      deletedAt: users.deletedAt,
      areaId: users.areaId,
      profileVisibility: users.profileVisibility,
      showGender: users.showGender,
      showAge: users.showAge,
      areaVisibility: users.areaVisibility,
    })
    .from(users)
    .where(eq(users.id, profileId))
    .limit(1);

  const user = rows[0];
  if (!user || user.deletedAt || user.status === "suspended") return null;

  const isOwner = Boolean(viewerId && viewerId === profileId);

  const [areaRows, interestRows, blockRows, sharedCircleRows] = await Promise.all([
    user.areaId
      ? db
          .select({
            nameEn: areas.nameEn,
            nameBn: areas.nameBn,
            zoneLabelEn: areas.zoneLabelEn,
            zoneLabelBn: areas.zoneLabelBn,
          })
          .from(areas)
          .where(eq(areas.id, user.areaId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ interest: interests })
      .from(userInterests)
      .innerJoin(interests, eq(userInterests.interestId, interests.id))
      .where(eq(userInterests.userId, profileId)),
    viewerId
      ? db
          .select({ id: blocks.id })
          .from(blocks)
          .where(
            or(
              and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, profileId)),
              and(eq(blocks.blockerId, profileId), eq(blocks.blockedId, viewerId)),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    viewerId && viewerId !== profileId && user.profileVisibility === "circles"
      ? db
          .select({ id: circleMembers.id })
          .from(circleMembers)
          .innerJoin(circles, eq(circleMembers.circleId, circles.id))
          .where(
            and(
              eq(circleMembers.userId, viewerId),
              inArray(circleMembers.status, ["invited", "active"]),
              inArray(circles.status, ["forming", "active"]),
              isNull(circles.deletedAt),
              // The peer must still be a current member of the same circle.
              sql`exists (select 1 from circle_members peer where peer.circle_id = ${circleMembers.circleId} and peer.user_id = ${profileId} and peer.status in ('invited', 'active'))`,
            ),
          )
          .limit(1)
      : Promise.resolve([] as { id: number }[]),
  ]);

  // A block is mutual invisibility, not a profile with a banner.
  if (blockRows.length > 0) return null;

  const canViewFull = canViewFullProfile({
    profileVisibility: user.profileVisibility as ProfileVisibility,
    isOwner,
    isSignedIn: Boolean(viewerId),
    sharesCircle: sharedCircleRows.length > 0,
  });

  const visibleArea = pickVisibleArea(
    areaRows[0] ?? null,
    user.areaVisibility as AreaVisibility,
    isOwner,
  );

  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: user.createdAt,
    restricted: !canViewFull,
    bio: canViewFull ? user.bio : null,
    gender: canViewFull && (isOwner || user.showGender) ? user.gender : null,
    birthYear: canViewFull && (isOwner || user.showAge) ? user.birthYear : null,
    area: canViewFull ? visibleArea : null,
    interests: canViewFull ? interestRows.map((r) => r.interest) : [],
    isBlocked: false,
  };
}

export interface UserSetup {
  preferences: typeof preferences.$inferSelect | null;
  settings: typeof userSettings.$inferSelect | null;
  interests: (typeof interests.$inferSelect)[];
  availability: (typeof availability.$inferSelect)[];
}

/** Everything onboarding and settings edit. */
export async function getUserSetup(userId: string): Promise<UserSetup> {
  const [prefs, interestRows, availRows, settingsRows] = await Promise.all([
    db.select().from(preferences).where(eq(preferences.userId, userId)).limit(1),
    db
      .select({ interest: interests })
      .from(userInterests)
      .innerJoin(interests, eq(userInterests.interestId, interests.id))
      .where(eq(userInterests.userId, userId)),
    db.select().from(availability).where(eq(availability.userId, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
  ]);

  return {
    preferences: prefs[0] ?? null,
    settings: settingsRows[0] ?? null,
    interests: interestRows.map((r) => r.interest),
    availability: availRows,
  };
}

/** Users this account has blocked. */
export async function getBlockedUsers(userId: string) {
  return db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      blockedAt: blocks.createdAt,
    })
    .from(blocks)
    .innerJoin(users, eq(blocks.blockedId, users.id))
    .where(eq(blocks.blockerId, userId))
    .orderBy(desc(blocks.createdAt));
}

/** Ids of everyone this user blocked, or who blocked them. */
export async function getBlockedIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));

  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  }
  return out;
}

/** How many active circles this user is in. */
export async function getUserActiveCircleCount(userId: string) {
  const rows = await db
    .select({ id: circleMembers.id })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(and(eq(circleMembers.userId, userId), eq(circles.status, "active")));
  return rows.length;
}

/** Notification preference lookup (defaults to everything on). */
export async function getNotificationPrefs(userId: string) {
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return (
    rows[0] ?? {
      userId,
      emailCircleInvites: true,
      emailActivityReminders: true,
      emailFeedbackRequests: true,
      emailGeneral: false,
      inAppNotifications: true,
      updatedAt: new Date(),
    }
  );
}

export type EmailPreference =
  | "emailCircleInvites"
  | "emailActivityReminders"
  | "emailFeedbackRequests"
  | "emailGeneral";

/** Whether a transactional email of this kind is enabled for the member. */
export async function emailAllowed(
  userId: string,
  key: EmailPreference,
): Promise<boolean> {
  const prefs = await getNotificationPrefs(userId);
  return prefs[key];
}

export { sql };

/** True when the user has a password (credential account) — legacy code-only accounts don't. */
export async function hasCredentialPassword(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, "credential"),
        isNotNull(accounts.password),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
