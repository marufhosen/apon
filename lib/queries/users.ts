import "server-only";

import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
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
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, profileId))
    .limit(1);

  const user = rows[0];
  if (!user || user.deletedAt || user.status === "suspended") return null;

  const [areaRows, interestRows, blockRows] = await Promise.all([
    user.areaId
      ? db.select().from(areas).where(eq(areas.id, user.areaId)).limit(1)
      : Promise.resolve([]),
    db
      .select({ interest: interests })
      .from(userInterests)
      .innerJoin(interests, eq(userInterests.interestId, interests.id))
      .where(eq(userInterests.userId, profileId)),
    viewerId
      ? db
          .select()
          .from(blocks)
          .where(
            and(
              or(eq(blocks.blockerId, viewerId), eq(blocks.blockerId, profileId)),
              or(eq(blocks.blockedId, viewerId), eq(blocks.blockedId, profileId)),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    gender: user.gender,
    birthYear: user.birthYear,
    role: user.role,
    createdAt: user.createdAt,
    area: areaRows[0] ?? null,
    interests: interestRows.map((r) => r.interest),
    isBlocked: blockRows.length > 0,
  };
}

export interface UserSetup {
  preferences: (typeof preferences.$inferSelect) | null;
  settings: (typeof userSettings.$inferSelect) | null;
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
    .where(
      and(eq(circleMembers.userId, userId), eq(circles.status, "active")),
    );
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
export async function emailAllowed(userId: string, key: EmailPreference): Promise<boolean> {
  const prefs = await getNotificationPrefs(userId);
  return prefs[key];
}

export { sql };

/** True when the user has a password (credential account) — legacy code-only accounts don't. */
export async function hasCredentialPassword(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential"), isNotNull(accounts.password)))
    .limit(1);
  return rows.length > 0;
}
