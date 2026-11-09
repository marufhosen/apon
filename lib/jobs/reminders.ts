import "server-only";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { activities, areas, notifications, rsvps, users, venues } from "@/lib/db/schema";
import { sendActivityReminderEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { emailAllowed } from "@/lib/queries/users";
import { formatDateTime } from "@/lib/dates";

/**
 * 24-hour reminders for upcoming activities.
 *
 * Idempotent: a reminder is only sent when no `activity_reminder` notification
 * exists for that user + activity yet, so re-running the job is safe.
 * `activityReminderSentAt` is tracked on the rsvp row via notification payload.
 */
export async function sendUpcomingReminders(): Promise<{ sent: number }> {
  const in24h = new Date(Date.now() + 24 * 3600_000);
  const windowStart = new Date(Date.now() + 20 * 3600_000);

  const upcoming = await db
    .select({
      activity: activities,
      venueName: venues.name,
      venueAddress: venues.address,
      areaName: areas.nameEn,
    })
    .from(activities)
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .where(
      and(
        eq(activities.status, "approved"),
        gt(activities.startsAt, windowStart),
        lt(activities.startsAt, in24h),
      ),
    );

  if (upcoming.length === 0) return { sent: 0 };

  let sent = 0;

  for (const row of upcoming) {
    const attendees = await db
      .select({ rsvp: rsvps, user: users })
      .from(rsvps)
      .innerJoin(users, eq(rsvps.userId, users.id))
      .where(and(eq(rsvps.activityId, row.activity.id), eq(rsvps.status, "going")));

    for (const attendee of attendees) {
      const already = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, attendee.user.id),
            eq(notifications.type, "activity_reminder"),
            sql`${notifications.payload} ->> 'activityId' = ${String(row.activity.id)}`,
          ),
        )
        .limit(1);

      if (already.length) continue;

      await notify({
        userId: attendee.user.id,
        type: "activity_reminder",
        title: row.activity.title,
        body: formatDateTime(row.activity.startsAt, attendee.user.locale),
        href: `/activities/${row.activity.id}`,
        payload: { activityId: row.activity.id },
      });

      if (await emailAllowed(attendee.user.id, "emailActivityReminders")) {
        await sendActivityReminderEmail({
          to: attendee.user.email,
          locale: attendee.user.locale,
          activityId: row.activity.id,
          title: row.activity.title,
          when: formatDateTime(row.activity.startsAt, attendee.user.locale),
          address: row.venueAddress ?? undefined,
        }).catch((err) => console.error("[reminders] email failed", err));
      }

      sent++;
    }
  }

  return { sent };
}
