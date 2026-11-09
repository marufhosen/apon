"use server";

import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import {
  activities,
  blocks,
  circleMembers,
  circleMessages,
  circles,
  reports,
  users,
} from "@/lib/db/schema";
import { blockSchema, reportSchema } from "@/lib/validations";
import { resolveOwnedAttachment } from "@/lib/uploads/server";

async function assertReportTargetVisible(
  targetType: "user" | "activity" | "message",
  targetId: string,
  reporterId: string,
) {
  if (targetType === "user") {
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, targetId), eq(users.status, "active"), isNull(users.deletedAt)),
      )
      .limit(1);
    if (!target) throw new ActionError("errors.notFoundTitle");
    return;
  }

  if (!/^[1-9]\d*$/.test(targetId)) throw new ActionError("errors.validation");
  const numericId = Number(targetId);

  if (targetType === "activity") {
    const [target] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.id, numericId), eq(activities.status, "approved")))
      .limit(1);
    if (!target) throw new ActionError("errors.notFoundTitle");
    return;
  }

  const [target] = await db
    .select({ id: circleMessages.id })
    .from(circleMessages)
    .innerJoin(circles, eq(circleMessages.circleId, circles.id))
    .innerJoin(
      circleMembers,
      and(
        eq(circleMembers.circleId, circleMessages.circleId),
        eq(circleMembers.userId, reporterId),
        eq(circleMembers.status, "active"),
      ),
    )
    .where(
      and(
        eq(circleMessages.id, numericId),
        inArray(circles.status, ["forming", "active"]),
        isNull(circles.deletedAt),
      ),
    )
    .limit(1);
  if (!target) throw new ActionError("errors.notFoundTitle");
}

/**
 * Report a user, activity or message.
 *
 * The report itself is private: the reporter keeps seeing the content, and the
 * reported party never learns who reported them.
 */
export const reportAction = createAction({
  schema: reportSchema,
  rateLimit: { key: "report" },
  revalidate: ["/"],
  handler: async (input, { user }: ActionContext) => {
    if (input.targetType === "user" && input.targetId === user.id) {
      throw new ActionError("errors.validation");
    }
    await assertReportTargetVisible(input.targetType, input.targetId, user.id);

    // One open report per target per reporter.
    const existing = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, user.id),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.status, "open"),
        ),
      )
      .limit(1);

    if (existing.length) throw new ActionError("safety.report.already");
    const attachmentUploadId = await resolveOwnedAttachment(
      user.id,
      input.attachmentUploadId,
      "report_evidence",
    );

    const rows = await db
      .insert(reports)
      .values({
        reporterId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details || null,
        attachmentUploadId,
      })
      .returning();

    return { reportId: rows[0]?.id ?? 0 };
  },
});

/**
 * Block a member. Blocked pairs never share a circle, and each side's messages
 * are hidden from the other (enforced at read time by `getBlockedIds`).
 */
export const blockAction = createAction({
  schema: blockSchema,
  rateLimit: { key: "safety" },
  revalidate: (input) => [`/profile/${input.userId}`, "/settings"],
  handler: async (input, { user }: ActionContext) => {
    if (input.userId === user.id) throw new ActionError("errors.validation");

    const target = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target.length) throw new ActionError("errors.notFoundTitle");

    const existing = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, input.userId)))
      .limit(1);

    if (!existing.length) {
      await db.insert(blocks).values({ blockerId: user.id, blockedId: input.userId });
    }

    // A block must never silently remove either person from a circle they
    // already belong to. Existing memberships stay intact; matching excludes
    // the pair from future circles and reads hide their content from each other.
    return { blocked: true };
  },
});

/** Unblock from the settings block list. */
export const unblockAction = createAction({
  schema: blockSchema,
  rateLimit: { key: "safety" },
  revalidate: ["/settings"],
  handler: async (input, { user }: ActionContext) => {
    await db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, input.userId)));
    return { unblocked: true };
  },
});
