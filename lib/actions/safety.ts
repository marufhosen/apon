"use server";

import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { blocks, reports, users } from "@/lib/db/schema";
import { blockSchema, reportSchema } from "@/lib/validations";
import { resolveOwnedAttachment } from "@/lib/uploads/server";

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

    // One open report per target per reporter.
    const existing = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, user.id),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
        ),
      )
      .limit(1);

    if (existing.length) throw new ActionError("safety.report.already");
    const attachmentUploadId = await resolveOwnedAttachment(user.id, input.attachmentUploadId, "report_evidence");

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
  revalidate: ["/settings"],
  handler: async (input, { user }: ActionContext) => {
    await db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, input.userId)));
    return { unblocked: true };
  },
});
