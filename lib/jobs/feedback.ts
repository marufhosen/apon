import "server-only";

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { activities, feedback, notifications, rsvps, users } from "@/lib/db/schema";
import { sendFeedbackRequestEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { emailAllowed } from "@/lib/queries/users";

/**
 * Asks everyone who attended a just-finished activity for private feedback.
 *
 * Idempotent: skips anyone who already has a `feedback_request` notification
 * for that activity, or who already submitted feedback.
 */
export async function requestFeedbackForCompleted(): Promise<{ sent: number }> {
  const cutoff = new Date(Date.now() - 30 * 60_000); // ended at least 30 min ago
  const since = new Date(Date.now() - 7 * 24 * 3600_000);

  const finished = await db
    .select({ activity: activities })
    .from(activities)
    .where(and(eq(activities.status, "completed"), lt(activities.endsAt, cutoff), gt(activities.endsAt, since)));

  if (finished.length === 0) return { sent: 0 };

  let sent = 0;

  for (const { activity } of finished) {
    const attendees = await db
      .select({ user: users })
      .from(rsvps)
      .innerJoin(users, eq(rsvps.userId, users.id))
      .where(and(eq(rsvps.activityId, activity.id), eq(rsvps.status, "going")));

    for (const attendee of attendees) {
      const alreadyNotified = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, attendee.user.id),
            eq(notifications.type, "feedback_request"),
            sql`${notifications.payload} ->> 'activityId' = ${String(activity.id)}`,
          ),
        )
        .limit(1);

      const alreadySubmitted = await db
        .select({ id: feedback.id })
        .from(feedback)
        .where(and(eq(feedback.userId, attendee.user.id), eq(feedback.activityId, activity.id)))
        .limit(1);

      if (alreadyNotified.length || alreadySubmitted.length) continue;

      await notify({
        userId: attendee.user.id,
        type: "feedback_request",
        title: activity.title,
        body: format(activity.endsAt, "EEE d MMM"),
        href: `/activities/${activity.id}`,
        payload: { activityId: activity.id },
      });

      if (await emailAllowed(attendee.user.id, "emailFeedbackRequests")) {
        await sendFeedbackRequestEmail({
          to: attendee.user.email,
          locale: attendee.user.locale,
          title: activity.title,
        }).catch((err) => console.error("[feedback] email failed", err));
      }

      sent++;
    }
  }

  return { sent };
}
