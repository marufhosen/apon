"use server";

import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { assertSelectableLocation } from "@/lib/queries/locations";
import {
  cleanupReplacedImage,
  deleteUserUploads,
  resolveOwnedImage,
} from "@/lib/uploads/server";
import {
  activities,
  availability,
  circleMembers,
  feedback,
  notifications,
  preferences,
  rsvps,
  userInterests,
  userSettings,
  users,
} from "@/lib/db/schema";
import {
  deleteAccountSchema,
  notificationPrefsSchema,
  privacySchema,
  profileSchema,
  settingsSchema,
} from "@/lib/validations";
import { notify } from "@/lib/notify";
import { reconcileCircle, sendCircleStateNotifications } from "@/lib/circles/lifecycle";

/** Edit public profile fields. */
export const updateProfile = createAction({
  schema: profileSchema,
  rateLimit: { key: "profile" },
  revalidate: (_input, user) => [`/profile/${user.id}`, "/settings", "/home"],
  handler: async (input, { user }: ActionContext): Promise<{ id: string }> => {
    if (input.areaId) await assertSelectableLocation(input.areaId);
    const avatarUrl = await resolveOwnedImage(
      user.id,
      input.avatarUrl,
      "avatar",
      user.avatarUrl,
    );
    const [updated] = await db
      .update(users)
      .set({
        name: input.name,
        gender: input.gender || null,
        birthYear: input.birthYear ?? null,
        bio: input.bio || null,
        avatarUrl,
        areaId: input.areaId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning({ id: users.id });

    if (!updated) throw new ActionError("errors.generic");
    await cleanupReplacedImage(user.avatarUrl, avatarUrl);
    return { id: updated.id };
  },
});

/**
 * Profile privacy. Enforced in `getPublicProfile`, not just hidden in the UI:
 * the query returns no bio, interests, area or sensitive fields unless the
 * viewer is allowed to see the full profile.
 */
export const updatePrivacySettings = createAction({
  schema: privacySchema,
  rateLimit: { key: "profile" },
  revalidate: (_input, user) => [`/profile/${user.id}`, "/settings"],
  handler: async (input, { user }: ActionContext) => {
    const [updated] = await db
      .update(users)
      .set({
        profileVisibility: input.profileVisibility,
        showGender: input.showGender,
        showAge: input.showAge,
        areaVisibility: input.areaVisibility,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning({ id: users.id });

    if (!updated) throw new ActionError("errors.generic");
    return { saved: true };
  },
});

/** Notification preferences (settings page). */
export const updateNotificationPrefs = createAction({
  schema: notificationPrefsSchema,
  rateLimit: { key: "profile" },
  revalidate: ["/settings"],
  handler: async (input, { user }: ActionContext) => {
    await db
      .insert(userSettings)
      .values({ userId: user.id, ...input, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { ...input, updatedAt: new Date() },
      });
    return { saved: true };
  },
});

/** Preferred language stored on the user record (URL prefix stays the source of truth for rendering). */
export const updateLanguage = createAction({
  schema: settingsSchema,
  rateLimit: { key: "profile" },
  revalidate: ["/settings", "/"],
  handler: async (input, { user }: ActionContext) => {
    await db
      .update(users)
      .set({ locale: input.locale, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { locale: input.locale };
  },
});

/**
 * Delete the account and remove personal data.
 *
 * Rows created by other people (circle messages already posted) keep their
 * content but lose the author link, so circles do not break apart.
 */
export const deleteAccount = createAction({
  schema: deleteAccountSchema,
  revalidate: ["/", "/sign-in"],
  handler: async (input, { user }: ActionContext) => {
    if (input.confirm !== "DELETE") throw new ActionError("settings.deleteError");

    const hosted = await db
      .select({ id: activities.id, title: activities.title })
      .from(activities)
      .where(
        and(
          eq(activities.hostId, user.id),
          inArray(activities.status, ["pending", "approved"]),
        ),
      );

    const circleChanges = await db.transaction(async (tx) => {
      const memberships = await tx
        .select({ circleId: circleMembers.circleId })
        .from(circleMembers)
        .where(and(eq(circleMembers.userId, user.id), eq(circleMembers.status, "active")))
        .orderBy(asc(circleMembers.circleId));

      // Lock in a stable order so deletion and invitation responses cannot
      // compute the same circle from different membership snapshots.
      for (const membership of memberships) {
        await tx.execute(
          sql`select id from circles where id = ${membership.circleId} for update`,
        );
      }

      await tx.delete(userInterests).where(eq(userInterests.userId, user.id));
      await tx.delete(availability).where(eq(availability.userId, user.id));
      await tx.delete(preferences).where(eq(preferences.userId, user.id));
      await tx.delete(userSettings).where(eq(userSettings.userId, user.id));
      await tx.delete(notifications).where(eq(notifications.userId, user.id));
      await tx.delete(feedback).where(eq(feedback.userId, user.id));
      await tx
        .update(rsvps)
        .set({ status: "cancelled" })
        .where(eq(rsvps.userId, user.id));
      await tx
        .update(circleMembers)
        .set({ status: "left", leftAt: new Date() })
        .where(eq(circleMembers.userId, user.id));

      const states = [];
      for (const membership of memberships) {
        states.push({
          circleId: membership.circleId,
          state: await reconcileCircle(tx, membership.circleId),
        });
      }
      await tx
        .update(activities)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          sql`${activities.hostId} = ${user.id} and ${activities.status} in ('pending', 'approved')`,
        );

      // Remove identity: the account row is kept (anonymous) so sessions can
      // be invalidated and foreign keys stay valid.
      await tx
        .update(users)
        .set({
          name: "Deleted member",
          email: `deleted+${user.id}@bondhu.invalid`,
          username: null,
          displayUsername: null,
          bio: null,
          avatarUrl: null,
          phoneNumber: null,
          phoneNumberVerified: false,
          gender: null,
          birthYear: null,
          areaId: null,
          profileVisibility: "hidden",
          showGender: false,
          showAge: false,
          areaVisibility: "hidden",
          status: "suspended",
          onboardedAt: null,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await tx.execute(sql`delete from sessions where user_id = ${user.id}`);
      await tx.execute(sql`delete from accounts where user_id = ${user.id}`);

      return states;
    });

    for (const change of circleChanges) {
      await sendCircleStateNotifications(change.circleId, change.state, {
        membershipChanged: true,
      });
    }

    // After the transaction commits: remove their uploads (public images still
    // referenced by retained activity/venue records are kept).
    await deleteUserUploads(user.id);

    // The cancelled activities were already communicated in-app; this makes
    // sure attendees are not left planning to attend a meetup that is gone.
    for (const activity of hosted) {
      const attendees = await db
        .select({ userId: rsvps.userId })
        .from(rsvps)
        .where(eq(rsvps.activityId, activity.id));
      for (const attendee of attendees) {
        await notify({
          userId: attendee.userId,
          type: "generic",
          title: activity.title,
          body: "This activity was cancelled because the host deleted their account.",
          href: `/activities/${activity.id}`,
          payload: { activityId: activity.id, cancelled: true },
        });
      }
    }

    return { deleted: true };
  },
});
