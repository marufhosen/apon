import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { circleMembers, circles } from "@/lib/db/schema";
import { notify } from "@/lib/notify";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface CircleState {
  status: string;
  activated: boolean;
  archived: boolean;
  releasedUserIds: string[];
  activeUserIds: string[];
  circleName: string;
}

/**
 * Recompute a circle after an invitation response or membership departure.
 * Callers lock the circle row before invoking this helper so concurrent
 * membership changes cannot observe an incomplete state.
 */
export async function reconcileCircle(tx: Tx, circleId: number): Promise<CircleState> {
  const [circle] = await tx
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1);
  if (!circle || circle.status === "archived") {
    return {
      status: circle?.status ?? "archived",
      activated: false,
      archived: false,
      releasedUserIds: [],
      activeUserIds: [],
      circleName: circle?.name ?? "",
    };
  }

  const members = await tx
    .select({ userId: circleMembers.userId, status: circleMembers.status })
    .from(circleMembers)
    .where(eq(circleMembers.circleId, circleId));

  const active = members.filter((member) => member.status === "active");
  const invited = members.filter((member) => member.status === "invited");
  const activeUserIds = active.map((member) => member.userId);

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
        activeUserIds,
        circleName: circle.name,
      };
    }
    return {
      status: "active",
      activated: false,
      archived: false,
      releasedUserIds: [],
      activeUserIds,
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
      activeUserIds,
      circleName: circle.name,
    };
  }

  // Nobody is left to answer and the circle cannot reach the minimum size.
  await tx
    .update(circles)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(circles.id, circleId));

  if (activeUserIds.length > 0) {
    await tx
      .update(circleMembers)
      .set({ status: "left", leftAt: new Date() })
      .where(
        and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, "active")),
      );
  }

  return {
    status: "archived",
    activated: false,
    archived: true,
    releasedUserIds: activeUserIds,
    activeUserIds: [],
    circleName: circle.name,
  };
}

export async function sendCircleStateNotifications(
  circleId: number,
  state: CircleState,
  options: { membershipChanged?: boolean } = {},
) {
  if (state.activated) {
    await Promise.all(
      state.activeUserIds.map((userId) =>
        notify({
          userId,
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
    return;
  }

  if (options.membershipChanged) {
    await Promise.all(
      state.activeUserIds.map((userId) =>
        notify({
          userId,
          type: "generic",
          title: state.circleName,
          href: `/circles/${circleId}`,
          payload: {
            circleId,
            membershipChanged: true,
            messageKey: "circleMembershipChanged",
          },
        }),
      ),
    );
  }
}
