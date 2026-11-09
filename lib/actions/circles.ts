"use server";

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import {
  circleMembers,
  circleMessages,
  circleRequests,
  circles,
  pollOptions,
  pollVotes,
  polls,
} from "@/lib/db/schema";
import {
  circleInviteSchema,
  circleMessageSchema,
  circleRequestSchema,
  createPollSchema,
  leaveCircleSchema,
  pollVoteSchema,
} from "@/lib/validations";
import { notify } from "@/lib/notify";

/** Membership gate shared by every circle action. Invited members must accept first. */
async function requireMember(circleId: number, userId: string) {
  const rows = await db
    .select({ member: circleMembers, circle: circles })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(
      and(
        eq(circleMembers.circleId, circleId),
        eq(circleMembers.userId, userId),
        eq(circleMembers.status, "active"),
        inArray(circles.status, ["forming", "active"]),
        sql`${circles.deletedAt} is null`,
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new ActionError("errors.unauthorized");
  return row.member;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface CircleState {
  status: string;
  activated: boolean;
  archived: boolean;
  releasedUserIds: string[];
  circleName: string;
}

/**
 * Keep the circle lifecycle consistent after a membership response.
 *
 * A circle needs three accepted members to go live. While invitations are
 * still pending it stays `forming`, so an invitee can still turn it around.
 * If everybody has answered and fewer than three accepted, the circle is
 * dissolved and the remaining members are returned to the matching pool
 * instead of being stranded in a circle that can never activate.
 */
async function reconcileCircle(tx: Tx, circleId: number): Promise<CircleState> {
  const [circle] = await tx.select().from(circles).where(eq(circles.id, circleId)).limit(1);
  if (!circle || circle.status === "archived") {
    return {
      status: circle?.status ?? "archived",
      activated: false,
      archived: false,
      releasedUserIds: [],
      circleName: circle?.name ?? "",
    };
  }

  const members = await tx
    .select({ userId: circleMembers.userId, status: circleMembers.status })
    .from(circleMembers)
    .where(eq(circleMembers.circleId, circleId));

  const active = members.filter((m) => m.status === "active");
  const invited = members.filter((m) => m.status === "invited");

  if (active.length >= 3) {
    if (circle.status !== "active") {
      await tx
        .update(circles)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(circles.id, circleId));
      return {
        status: "active",
        activated: true,
        archived: false,
        releasedUserIds: [],
        circleName: circle.name,
      };
    }
    return {
      status: "active",
      activated: false,
      archived: false,
      releasedUserIds: [],
      circleName: circle.name,
    };
  }

  if (invited.length > 0) {
    if (circle.status !== "forming") {
      await tx
        .update(circles)
        .set({ status: "forming", updatedAt: new Date() })
        .where(eq(circles.id, circleId));
    }
    return {
      status: "forming",
      activated: false,
      archived: false,
      releasedUserIds: [],
      circleName: circle.name,
    };
  }

  // Nobody is left to answer and the circle cannot reach the minimum size.
  await tx
    .update(circles)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(circles.id, circleId));

  const releasedUserIds = active.map((m) => m.userId);
  if (releasedUserIds.length > 0) {
    await tx
      .update(circleMembers)
      .set({ status: "left", leftAt: new Date() })
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, "active")));
  }

  return {
    status: "archived",
    activated: false,
    archived: true,
    releasedUserIds,
    circleName: circle.name,
  };
}

async function sendCircleStateNotifications(circleId: number, state: CircleState) {
  if (state.activated) {
    const members = await db
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, "active")));

    await Promise.all(
      members.map((m) =>
        notify({
          userId: m.userId,
          type: "circle_activated",
          title: state.circleName,
          body: "Your circle now has enough members. Pick a time to meet.",
          href: `/circles/${circleId}`,
          payload: { circleId },
        }),
      ),
    );
  }

  if (state.archived) {
    await Promise.all(
      state.releasedUserIds.map((userId) =>
        notify({
          userId,
          type: "generic",
          title: "This circle could not be formed",
          body: "We will match you again in the next weekly run.",
          href: "/circles",
          payload: { circleId },
        }),
      ),
    );
  }
}

/** Post a lightweight comment. No real-time — the page revalidates on write. */
export const postCircleMessage = createAction({
  schema: circleMessageSchema,
  authorize: "user",
  rateLimit: { key: "message" },
  revalidate: (input) => [`/circles/${input.circleId}`],
  handler: async (input, { user }: ActionContext) => {
    await requireMember(input.circleId, user.id);

    // Hide messages from anyone the author blocked (or who blocked them).
    const rows = await db
      .insert(circleMessages)
      .values({ circleId: input.circleId, userId: user.id, body: input.body })
      .returning();

    const message = rows[0];
    if (!message) throw new ActionError("errors.generic");

    const fellowMembers = await db
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(
        and(
          eq(circleMembers.circleId, input.circleId),
          sql`${circleMembers.userId} <> ${user.id}`,
          eq(circleMembers.status, "active"),
        ),
      );

    for (const m of fellowMembers) {
      await notify({
        userId: m.userId,
        type: "generic",
        title: user.name,
        body: input.body.slice(0, 120),
        href: `/circles/${input.circleId}`,
        payload: { circleId: input.circleId, messageId: message.id },
      });
    }

    return { messageId: message.id };
  },
});

/**
 * Vote on the meetup time poll. Voting again replaces this member's previous
 * choices; other members' votes are never touched.
 */
export const votePoll = createAction({
  schema: pollVoteSchema,
  revalidate: ["/circles", "/home"],
  handler: async (input, { user }: ActionContext) => {
    const pollRows = await db.select().from(polls).where(eq(polls.id, input.pollId)).limit(1);
    const poll = pollRows[0];
    if (!poll) throw new ActionError("errors.notFoundTitle");
    if (poll.status !== "open") throw new ActionError("errors.generic");
    if (poll.closesAt && poll.closesAt.getTime() < Date.now()) {
      throw new ActionError("errors.generic");
    }

    await requireMember(poll.circleId, user.id);

    const optionRows = await db
      .select()
      .from(pollOptions)
      .where(eq(pollOptions.pollId, input.pollId));
    const validIds = new Set(optionRows.map((o) => o.id));
    if (!input.optionIds.every((id) => validIds.has(id))) {
      throw new ActionError("errors.validation");
    }

    // A member may select several times, but each option only once. Keep the
    // other members' rows untouched: the delete is scoped to this voter.
    const optionIds = [...new Set(input.optionIds)];
    await db.transaction(async (tx) => {
      await tx
        .delete(pollVotes)
        .where(and(eq(pollVotes.pollId, input.pollId), eq(pollVotes.userId, user.id)));
      await tx
        .insert(pollVotes)
        .values(optionIds.map((optionId) => ({ pollId: input.pollId, optionId, userId: user.id })));
    });

    return { voted: optionIds.length };
  },
});

async function respondToInvite(
  circleId: number,
  userId: string,
  response: "accept" | "decline",
) {
  const state = await db.transaction(async (tx) => {
    // Serialise accept/decline for one circle so two simultaneous accepts
    // cannot each observe two active members and both miss the activation.
    await tx.execute(sql`select id from circles where id = ${circleId} for update`);

    const [circle] = await tx
      .select()
      .from(circles)
      .where(and(eq(circles.id, circleId), sql`${circles.deletedAt} is null`))
      .limit(1);
    if (!circle || circle.status === "archived") throw new ActionError("errors.notFoundTitle");

    const [member] = await tx
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
      .limit(1);
    if (!member) throw new ActionError("errors.unauthorized");

    if (member.status === "active") {
      return {
        status: circle.status,
        activated: false,
        archived: false,
        releasedUserIds: [],
        circleName: circle.name,
      } satisfies CircleState;
    }
    if (member.status !== "invited") throw new ActionError("errors.unauthorized");

    if (response === "accept") {
      await tx
        .update(circleMembers)
        .set({ status: "active", joinedAt: new Date(), leftAt: null })
        .where(eq(circleMembers.id, member.id));
    } else {
      await tx
        .update(circleMembers)
        .set({ status: "declined", leftAt: new Date() })
        .where(eq(circleMembers.id, member.id));
    }

    return reconcileCircle(tx, circleId);
  });

  await sendCircleStateNotifications(circleId, state);
  return { status: state.status, activated: state.activated, archived: state.archived };
}

/** Accept the invitation that the weekly matcher created. */
export const acceptCircleInvite = createAction({
  schema: circleInviteSchema,
  revalidate: (input) => [
    `/circles/${input.circleId}`,
    "/circles",
    "/home",
    "/notifications",
  ],
  handler: async (input, { user }: ActionContext) =>
    respondToInvite(input.circleId, user.id, "accept"),
});

/** Decline an invitation. The seat returns to the matching pool. */
export const declineCircleInvite = createAction({
  schema: circleInviteSchema,
  revalidate: (input) => [
    `/circles/${input.circleId}`,
    "/circles",
    "/home",
    "/notifications",
  ],
  handler: async (input, { user }: ActionContext) =>
    respondToInvite(input.circleId, user.id, "decline"),
});

/** Any active member can propose another time poll for the circle. */
export const createPoll = createAction({
  schema: createPollSchema,
  revalidate: (input) => [`/circles/${input.circleId}`],
  handler: async (input, { user }: ActionContext) => {
    await requireMember(input.circleId, user.id);

    const created = await db.transaction(async (tx) => {
      const [poll] = await tx
        .insert(polls)
        .values({ circleId: input.circleId, title: input.title, status: "open" })
        .returning();

      await tx
        .insert(pollOptions)
        .values(input.options.map((o) => ({ pollId: poll.id, label: o.label })));

      return poll;
    });

    return { pollId: created.id };
  },
});

/** Leave a circle. The seat goes back to the matching pool. */
export const leaveCircle = createAction({
  schema: leaveCircleSchema,
  revalidate: (input) => [`/circles/${input.circleId}`, "/circles", "/home"],
  handler: async (input, { user }: ActionContext) => {
    const state = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from circle_members where circle_id = ${input.circleId} and user_id = ${user.id} for update`,
      );

      const [member] = await tx
        .select()
        .from(circleMembers)
        .where(
          and(
            eq(circleMembers.circleId, input.circleId),
            eq(circleMembers.userId, user.id),
            eq(circleMembers.status, "active"),
          ),
        )
        .limit(1);
      if (!member) throw new ActionError("errors.unauthorized");

      await tx
        .update(circleMembers)
        .set({ status: "left", leftAt: new Date() })
        .where(eq(circleMembers.id, member.id));

      return reconcileCircle(tx, input.circleId);
    });

    await sendCircleStateNotifications(input.circleId, state);
    return { left: true, dissolved: state.archived };
  },
});

/** "Request a new circle" with an optional private reason. */
export const requestCircle = createAction({
  schema: circleRequestSchema,
  rateLimit: { key: "circleRequest" },
  revalidate: ["/circles"],
  handler: async (input, { user }: ActionContext) => {
    const openCount = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(circleRequests)
      .where(
        and(eq(circleRequests.userId, user.id), eq(circleRequests.status, "open")),
      );

    if ((openCount[0]?.count ?? 0) > 0) throw new ActionError("circles.request.submitted");

    const rows = await db
      .insert(circleRequests)
      .values({ userId: user.id, reason: input.reason || null })
      .returning();

    return { requestId: rows[0]?.id ?? 0 };
  },
});
