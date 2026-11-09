"use server";

import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { activities, feedback, rsvps } from "@/lib/db/schema";
import { feedbackSchema } from "@/lib/validations";
import { notify } from "@/lib/notify";

/**
 * Private post-meetup feedback. Never surfaced publicly: rows are only ever
 * read in aggregate for admin metrics.
 */
export const submitFeedback = createAction({
  schema: feedbackSchema,
  authorize: "user",
  rateLimit: { key: "feedback" },
  revalidate: ["/home", "/activities"],
  handler: async (input, { user }: ActionContext) => {
    const activityRows = await db
      .select()
      .from(activities)
      .where(eq(activities.id, input.activityId))
      .limit(1);
    const activity = activityRows[0];
    if (!activity) throw new ActionError("errors.notFoundTitle");
    if (activity.status !== "completed" || activity.endsAt > new Date()) {
      throw new ActionError("feedback.notReady");
    }

    const [mine] = await db
      .select()
      .from(rsvps)
      .where(
        and(
          eq(rsvps.activityId, input.activityId),
          eq(rsvps.userId, user.id),
          eq(rsvps.status, "going"),
        ),
      )
      .limit(1);
    if (!mine) throw new ActionError("errors.unauthorized");

    const existing = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(and(eq(feedback.userId, user.id), eq(feedback.activityId, input.activityId)))
      .limit(1);
    if (existing.length) throw new ActionError("feedback.already");

    await db
      .insert(feedback)
      .values({
        userId: user.id,
        activityId: input.activityId,
        circleId: activity.circleId,
        comfortable: input.comfortable,
        wantToMeetAgain: input.wantToMeetAgain,
        madeConnection: input.madeConnection,
        note: input.note || null,
      })
      .onConflictDoNothing();

    await notify({
      userId: user.id,
      type: "feedback_request",
      title: activity.title,
      body: "",
      href: "/home",
      payload: { activityId: activity.id, thanked: true },
    });

    return { submitted: true };
  },
});
