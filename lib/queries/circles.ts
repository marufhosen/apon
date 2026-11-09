import "server-only";

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  circleMembers,
  circleMessages,
  circles,
  pollOptions,
  pollVotes,
  polls,
  users,
  activities,
  venues,
  areas,
} from "@/lib/db/schema";

/** The user's current circle (if any), with everything the page needs. */
export async function getMyCircle(userId: string) {
  const membership = await db
    .select({ member: circleMembers, circle: circles })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(
      and(
        eq(circleMembers.userId, userId),
        inArray(circleMembers.status, ["invited", "active"]),
        inArray(circles.status, ["forming", "active"]),
        sql`${circles.deletedAt} is null`,
      ),
    )
    .orderBy(
      sql`case when ${circles.status} = 'active' then 0 else 1 end`,
      desc(circles.createdAt),
    )
    .limit(1);

  const row = membership[0];
  if (!row) return null;

  return getCircleBundle(row.circle.id, row.member.id, userId);
}

/** Membership-scoped bundle used by the circle page. */
export async function getCircleBundle(
  circleId: number,
  membershipId: number,
  userId: string,
) {
  const circleRows = await db
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1);
  const circle = circleRows[0];
  if (!circle) return null;

  const members = await db
    .select({
      membership: circleMembers,
      user: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        gender: users.gender,
        birthYear: users.birthYear,
        areaId: users.areaId,
      },
    })
    .from(circleMembers)
    .innerJoin(users, eq(circleMembers.userId, users.id))
    .where(
      and(
        eq(circleMembers.circleId, circleId),
        or(eq(circleMembers.status, "active"), eq(circleMembers.id, membershipId)),
      ),
    )
    .orderBy(asc(circleMembers.createdAt));

  const nextActivities = await db
    .select({
      activity: activities,
      venueName: venues.name,
      areaName: areas.nameEn,
    })
    .from(activities)
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .where(and(eq(activities.circleId, circleId), eq(activities.status, "approved")))
    .orderBy(asc(activities.startsAt))
    .limit(3);

  const pollRows = await db
    .select({ poll: polls })
    .from(polls)
    .where(eq(polls.circleId, circleId))
    .orderBy(desc(polls.createdAt))
    .limit(1);

  const poll = pollRows[0]?.poll ?? null;
  let pollBundle: PollBundle | null = null;

  if (poll) {
    const options = await db
      .select()
      .from(pollOptions)
      .where(eq(pollOptions.pollId, poll.id))
      .orderBy(asc(pollOptions.id));

    const votes = await db.select().from(pollVotes).where(eq(pollVotes.pollId, poll.id));

    pollBundle = {
      poll,
      options: options.map((o) => ({
        ...o,
        voteCount: votes.filter((v) => v.optionId === o.id).length,
        votedByMe: votes.some((v) => v.optionId === o.id && v.userId === userId),
      })),
      myVoteCount: votes.filter((v) => v.userId === userId).length,
      totalVotes: votes.length,
    };
  }

  const recentMessages = await db
    .select({
      message: circleMessages,
      user: { id: users.id, name: users.name, avatarUrl: users.avatarUrl },
    })
    .from(circleMessages)
    .innerJoin(users, eq(circleMessages.userId, users.id))
    .where(eq(circleMessages.circleId, circleId))
    .orderBy(desc(circleMessages.createdAt))
    .limit(200);

  const messages = recentMessages.reverse();

  const myMembership = members.find((m) => m.membership.id === membershipId);

  return {
    circle,
    members,
    myMembership,
    nextActivities,
    poll: pollBundle,
    messages,
  };
}

export interface PollBundle {
  poll: typeof polls.$inferSelect;
  options: (typeof pollOptions.$inferSelect & {
    voteCount: number;
    votedByMe: boolean;
  })[];
  myVoteCount: number;
  totalVotes: number;
}

/** Membership lookup used to enforce "visible only to members". */
export async function getCircleMembership(circleId: number, userId: string) {
  const rows = await db
    .select()
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Every circle, for the admin overview. */
export async function listCircles() {
  return db
    .select({
      circle: circles,
      memberCount:
        sql<number>`(select count(*) from circle_members cm where cm.circle_id = ${circles.id} and cm.status = 'active')`.mapWith(
          Number,
        ),
      zoneLabel: circles.zone,
    })
    .from(circles)
    .orderBy(desc(circles.createdAt));
}

/** Members currently in an active circle — used by matching to exclude them. */
export async function getActiveCircleMemberIds() {
  const rows = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(
      and(
        inArray(circleMembers.status, ["invited", "active"]),
        eq(circles.status, "active"),
        sql`${circles.deletedAt} is null`,
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/**
 * Admin view of one circle: details, every member (any status), upcoming
 * meetups, the latest time poll and chat *activity* (counts only — members'
 * private messages are not shown in the Admin Panel; reported messages reach
 * admins through the Reports queue).
 */
export async function getAdminCircleDetail(circleId: number) {
  const [circle] = await db
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1);
  if (!circle) return null;

  const [zoneRow] = await db
    .select({ en: areas.zoneLabelEn, bn: areas.zoneLabelBn })
    .from(areas)
    .where(eq(areas.zone, circle.zone))
    .limit(1);

  const [members, upcoming, latestPoll, chat] = await Promise.all([
    db
      .select({
        membership: circleMembers,
        user: {
          id: users.id,
          name: users.name,
          username: users.displayUsername,
          avatarUrl: users.avatarUrl,
          gender: users.gender,
          birthYear: users.birthYear,
          status: users.status,
        },
        areaName: areas.nameEn,
        areaNameBn: areas.nameBn,
      })
      .from(circleMembers)
      .innerJoin(users, eq(circleMembers.userId, users.id))
      .leftJoin(areas, eq(users.areaId, areas.id))
      .where(eq(circleMembers.circleId, circleId))
      .orderBy(
        sql`case ${circleMembers.status} when 'active' then 0 when 'invited' then 1 else 2 end`,
        asc(users.name),
      ),
    db
      .select({ activity: activities, venueName: venues.name })
      .from(activities)
      .leftJoin(venues, eq(activities.venueId, venues.id))
      .where(and(eq(activities.circleId, circleId), sql`${activities.startsAt} > now()`))
      .orderBy(asc(activities.startsAt))
      .limit(5),
    db
      .select()
      .from(polls)
      .where(eq(polls.circleId, circleId))
      .orderBy(desc(polls.createdAt))
      .limit(1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        hidden: sql<number>`count(*) filter (where ${circleMessages.hiddenAt} is not null)::int`,
        lastAt: sql<Date | null>`max(${circleMessages.createdAt})`,
      })
      .from(circleMessages)
      .where(eq(circleMessages.circleId, circleId)),
  ]);

  const poll = latestPoll[0] ?? null;
  const options = poll
    ? await db
        .select({
          id: pollOptions.id,
          label: pollOptions.label,
          votes: sql<number>`(select count(*)::int from ${pollVotes} v where v.option_id = ${pollOptions.id})`,
        })
        .from(pollOptions)
        .where(eq(pollOptions.pollId, poll.id))
    : [];

  return {
    circle,
    zoneLabel: zoneRow ?? null,
    members,
    upcoming,
    poll: poll ? { poll, options } : null,
    chat: {
      total: chat[0]?.total ?? 0,
      hidden: chat[0]?.hidden ?? 0,
      lastAt: chat[0]?.lastAt ? new Date(chat[0].lastAt) : null,
    },
  };
}
