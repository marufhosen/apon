"use server";

import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { activities, rsvps, users, venues, areas } from "@/lib/db/schema";
import { rsvpSchema } from "@/lib/validations";
import { pickPromotion, resolveRsvpStatus, toRsvpStatus } from "@/lib/rsvp/waitlist";
import { sendWaitlistPromotionEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { emailAllowed } from "@/lib/queries/users";

export interface RsvpResult {
  status: "going" | "waitlist" | "cancelled";
  /** True when this join landed straight in a free spot. */
  promotedFromWaitlist?: boolean;
}

/**
 * RSVP / cancel / waitlist — all inside one transaction so capacity can never
 * be oversold. Cancelling automatically promotes the first waitlisted member.
 */
export const rsvpAction = createAction({
  schema: rsvpSchema,
  authorize: "verified-phone",
  rateLimit: { key: "rsvp" },
  revalidate: (input) => [
    `/activities/${input.activityId}`,
    "/activities",
    "/home",
    "/circles",
  ],
  tags: ["activities"],
  handler: async (input, { user }: ActionContext): Promise<RsvpResult> => {
    const now = new Date();

    const outcome = await db.transaction(async (tx) => {
      const activityRows = await tx
        .select({ activity: activities, venueName: venues.name, areaName: areas.nameEn })
        .from(activities)
        .leftJoin(venues, eq(activities.venueId, venues.id))
        .leftJoin(areas, eq(activities.areaId, areas.id))
        .where(eq(activities.id, input.activityId))
        .for("update", { of: activities });

      const activity = activityRows[0]?.activity;
      if (!activity) throw new ActionError("errors.notFoundTitle");
      if (activity.status === "cancelled") {
        throw new ActionError("activities.detail.cancelled");
      }
      if (activity.status === "pending") {
        throw new ActionError("activities.detail.pending");
      }
      if (activity.status === "completed" || activity.startsAt <= now) {
        throw new ActionError("errors.generic");
      }
      if (activity.womenOnly && user.gender !== "female") {
        throw new ActionError("activities.detail.womenOnlyNote");
      }

      const existingRows = await tx
        .select()
        .from(rsvps)
        .where(and(eq(rsvps.activityId, input.activityId), eq(rsvps.userId, user.id)))
        .limit(1);
      const existing = existingRows[0] ?? null;

      if (input.action === "cancel" || input.action === "leave-waitlist") {
        if (!existing || existing.status === "cancelled") {
          throw new ActionError("errors.generic");
        }
        await tx
          .update(rsvps)
          .set({ status: "cancelled", checkedIn: false, updatedAt: now })
          .where(eq(rsvps.id, existing.id));

        // Promote the longest-waiting member, if any.
        const waitingRows = await tx
          .select({ rsvp: rsvps, user: users, createdAt: rsvps.createdAt })
          .from(rsvps)
          .innerJoin(users, eq(rsvps.userId, users.id))
          .where(and(eq(rsvps.activityId, input.activityId), eq(rsvps.status, "waitlist")))
          .orderBy(asc(rsvps.createdAt))
          .limit(1);

        const promoted = pickPromotion(waitingRows);
        if (promoted) {
          await tx
            .update(rsvps)
            .set({ status: "going", updatedAt: new Date() })
            .where(eq(rsvps.id, promoted.rsvp.id));
        }

        return {
          status: "cancelled" as const,
          promoted: promoted
            ? {
                userId: promoted.user.id,
                email: promoted.user.email,
                name: promoted.user.name,
                locale: promoted.user.locale,
                activityId: activity.id,
                title: activity.title,
                startsAt: activity.startsAt,
                venueName: activityRows[0]?.venueName ?? null,
                areaName: activityRows[0]?.areaName ?? null,
              }
            : null,
        };
      }

      // join / waitlist ----------------------------------------------------
      const goingRows = await tx
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(rsvps)
        .where(and(eq(rsvps.activityId, input.activityId), eq(rsvps.status, "going")));

      const going = goingRows[0]?.count ?? 0;
      const status = resolveRsvpStatus({
        action: input.action === "waitlist" ? "waitlist" : "join",
        going,
        capacity: activity.capacity,
        current: toRsvpStatus(existing?.status),
      });

      if (existing) {
        if (existing.status === "going" && status === "going") {
          return { status: "going" as const, promoted: null };
        }
        await tx
          .update(rsvps)
          .set({ status, checkedIn: false, updatedAt: now })
          .where(eq(rsvps.id, existing.id));
      } else {
        await tx.insert(rsvps).values({
          activityId: input.activityId,
          userId: user.id,
          status,
        });
      }

      return { status, promoted: null };
    });

    // Post-transaction side effects (outside the lock).
    if (outcome.promoted) {
      await notify({
        userId: outcome.promoted.userId,
        type: "waitlist_promotion",
        title: outcome.promoted.title,
        body: outcome.promoted.venueName ?? "",
        href: `/activities/${outcome.promoted.activityId}`,
        payload: { activityId: outcome.promoted.activityId },
      });
      if (await emailAllowed(outcome.promoted.userId, "emailActivityReminders")) {
        await sendWaitlistPromotionEmail({
          to: outcome.promoted.email,
          locale: outcome.promoted.locale,
          title: outcome.promoted.title,
          when: outcome.promoted.startsAt.toISOString(),
        }).catch((err) => console.error("[rsvp] promotion email failed", err));
      }
    }

    return { status: outcome.status };
  },
});