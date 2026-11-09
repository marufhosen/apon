import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notifications, userSettings } from "@/lib/db/schema";

export type NotificationType =
  | "circle_invite"
  | "circle_activated"
  | "activity_reminder"
  | "waitlist_promotion"
  | "host_approval"
  | "feedback_request"
  | "report_update"
  | "generic";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  payload?: Record<string, unknown>;
}

/** Creates an in-app notification (never throws into the calling action). */
export async function notify(input: CreateNotificationInput): Promise<void> {
  try {
    const [settings] = await db
      .select({ inAppNotifications: userSettings.inAppNotifications })
      .from(userSettings)
      .where(eq(userSettings.userId, input.userId))
      .limit(1);

    // Missing settings mean the defaults (in-app notifications on).
    if (settings && !settings.inAppNotifications) return;

    await db.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      payload: input.payload ?? {},
    });
  } catch (err) {
    console.error("[notify] failed", err);
  }
}

export async function markAllRead(userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(sql`${notifications.userId} = ${userId} and ${notifications.readAt} is null`);
}

export async function markRead(notificationId: number, userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}
