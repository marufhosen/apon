import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { addDays, setHours, startOfWeek } from "date-fns";

import { db } from "@/lib/db";
import {
  areas,
  availability,
  blocks,
  circleMembers,
  circles,
  notifications,
  pollOptions,
  polls,
  preferences,
  userInterests,
  userSettings,
  users,
} from "@/lib/db/schema";
import { sendCircleInviteEmail } from "@/lib/email";
import {
  matchAll,
  pairKey,
  type MatchCandidate,
  type MatchContext,
  type MatchGroup,
} from "@/lib/matching/core";

export interface MatchingResult {
  poolSize: number;
  groupsCreated: number;
  membersInvited: number;
  groups: MatchGroup[];
}

/**
 * Weekly matching run.
 *
 * Pool = onboarded, phone-verified, active users who are not already in a
 * circle. Blocked pairs and people who previously left a circle together are
 * excluded before grouping; each new circle starts as `forming` with a time
 * poll and an invite notification + email per member.
 */
export async function runMatching(): Promise<MatchingResult> {
  const poolRows = await db
    .select({
      id: users.id,
      birthYear: users.birthYear,
      zone: sql<string>`coalesce(${areas.zone}, 'unknown')`,
    })
    .from(users)
    .leftJoin(areas, eq(users.areaId, areas.id))
    .where(
      and(
        eq(users.status, "active"),
        sql`${users.onboardedAt} is not null`,
        sql`${users.deletedAt} is null`,
        sql`${users.phoneNumberVerified} = true`,
        sql`not exists (
          select 1 from circle_members cm
          join circles c on c.id = cm.circle_id
          where cm.user_id = ${users.id}
            and cm.status in ('invited', 'active')
            and c.status <> 'archived'
            and c.deleted_at is null
        )`,
      ),
    );

  if (poolRows.length === 0) {
    return { poolSize: 0, groupsCreated: 0, membersInvited: 0, groups: [] };
  }

  const ids = poolRows.map((r) => r.id);

  const [interestRows, availabilityRows, preferenceRows, blockRows, leftRows] = await Promise.all([
    db.select().from(userInterests).where(inArray(userInterests.userId, ids)),
    db.select().from(availability).where(inArray(availability.userId, ids)),
    db.select().from(preferences).where(inArray(preferences.userId, ids)),
    db.select().from(blocks),
    db
      .select({ circleId: circleMembers.circleId, userId: circleMembers.userId })
      .from(circleMembers)
      .where(eq(circleMembers.status, "left")),
  ]);

  // --- Index the pool ------------------------------------------------------
  const interestsByUser = new Map<string, number[]>();
  for (const row of interestRows) {
    const list = interestsByUser.get(row.userId) ?? [];
    list.push(row.interestId);
    interestsByUser.set(row.userId, list);
  }

  const availabilityByUser = new Map<string, string[]>();
  for (const row of availabilityRows) {
    const list = availabilityByUser.get(row.userId) ?? [];
    list.push(`${row.weekday}:${row.slot}`);
    availabilityByUser.set(row.userId, list);
  }

  const prefsByUser = new Map<string, (typeof preferenceRows)[number]>();
  for (const row of preferenceRows) prefsByUser.set(row.userId, row);

  const candidates: MatchCandidate[] = poolRows.map((row) => {
    const prefs = prefsByUser.get(row.id);
    return {
      userId: row.id,
      zone: row.zone,
      womenOnly: prefs?.womenOnly ?? false,
      interests: interestsByUser.get(row.id) ?? [],
      availability: availabilityByUser.get(row.id) ?? [],
      birthYear: row.birthYear,
      language: (prefs?.language ?? "both") as MatchCandidate["language"],
      groupSize: (prefs?.groupSize ?? "small") as MatchCandidate["groupSize"],
    };
  });

  const ctx = await buildContext(blockRows, leftRows);
  const groups = matchAll(candidates, ctx);

  if (groups.length === 0) {
    return { poolSize: ids.length, groupsCreated: 0, membersInvited: 0, groups };
  }

  // --- Materialise --------------------------------------------------------
  let membersInvited = 0;

  for (const group of groups) {
    const circleZone = candidates.find((c) => c.userId === group.memberIds[0])?.zone ?? "unknown";
    const womenOnly = candidates.find((c) => c.userId === group.memberIds[0])?.womenOnly ?? false;
    const name = circleName(circleZone);

    const circle = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(circles)
        .values({
          name,
          zone: circleZone,
          status: "forming",
          womenOnly,
          createdBy: "system",
          matchedAt: new Date(),
        })
        .returning();

      await tx.insert(circleMembers).values(
        group.memberIds.map((userId) => ({
          circleId: created.id,
          userId,
          role: "member" as const,
          status: "invited" as const,
        })),
      );

      const [poll] = await tx
        .insert(polls)
        .values({
          circleId: created.id,
          title: "When should we meet for the first time?",
          status: "open",
          closesAt: addDays(new Date(), 5),
        })
        .returning();

      const saturday = setHours(startOfWeek(addDays(new Date(), 7), { weekStartsOn: 6 }), 10);
      await tx.insert(pollOptions).values([
        {
          pollId: poll.id,
          label: "Saturday 10:00 AM",
          startsAt: saturday,
          endsAt: new Date(saturday.getTime() + 2 * 3600_000),
        },
        {
          pollId: poll.id,
          label: "Saturday 5:00 PM",
          startsAt: setHours(saturday, 17),
          endsAt: setHours(saturday, 19),
        },
        {
          pollId: poll.id,
          label: "Sunday 9:00 AM",
          startsAt: setHours(addDays(saturday, 1), 9),
          endsAt: setHours(addDays(saturday, 1), 11),
        },
      ]);

      await tx.insert(notifications).values(
        group.memberIds.map((userId) => ({
          userId,
          type: "circle_invite",
          title: created.name,
          body: `${group.memberIds.length} people near you. Pick a time that works.`,
          href: `/circles/${created.id}`,
          payload: { circleId: created.id, averageScore: group.averageScore },
        })),
      );

      return created;
    });

    membersInvited += group.memberIds.length;

    const [emails, settings] = await Promise.all([
      db
        .select({ id: users.id, email: users.email, locale: users.locale })
        .from(users)
        .where(inArray(users.id, group.memberIds)),
      db
        .select({
          userId: userSettings.userId,
          emailCircleInvites: userSettings.emailCircleInvites,
        })
        .from(userSettings)
        .where(inArray(userSettings.userId, group.memberIds)),
    ]);

    const inviteEmailsEnabled = new Set(
      settings.filter((s) => s.emailCircleInvites).map((s) => s.userId),
    );

    await Promise.all(
      emails
        .filter(
          (e) =>
            !settings.some((s) => s.userId === e.id) || inviteEmailsEnabled.has(e.id),
        )
        .map((e) =>
          sendCircleInviteEmail({
            to: e.email,
            locale: e.locale,
            circleId: circle.id,
            circleName: circle.name,
            memberCount: group.memberIds.length,
          }).catch((err) => console.error("[matching] invite email failed", err)),
        ),
    );
  }

  return { poolSize: ids.length, groupsCreated: groups.length, membersInvited, groups };
}

async function buildContext(
  blockRows: (typeof blocks.$inferSelect)[],
  leftRows: { circleId: number; userId: string }[],
): Promise<MatchContext> {
  const blockedPairs = new Set<string>();
  for (const row of blockRows) blockedPairs.add(pairKey(row.blockerId, row.blockedId));

  // Everyone who ever shared a circle with someone who left is excluded from
  // being grouped with that person again.
  const leftTogether = new Set<string>();
  const leftCircleIds = [...new Set(leftRows.map((r) => r.circleId))];
  if (leftCircleIds.length) {
    const leaversByCircle = new Map<number, Set<string>>();
    for (const row of leftRows) {
      const set = leaversByCircle.get(row.circleId) ?? new Set<string>();
      set.add(row.userId);
      leaversByCircle.set(row.circleId, set);
    }

    const formerMembers = await db
      .select({ circleId: circleMembers.circleId, userId: circleMembers.userId })
      .from(circleMembers)
      .where(inArray(circleMembers.circleId, leftCircleIds));

    const membersByCircle = new Map<number, string[]>();
    for (const row of formerMembers) {
      const list = membersByCircle.get(row.circleId) ?? [];
      list.push(row.userId);
      membersByCircle.set(row.circleId, list);
    }

    for (const [circleId, members] of membersByCircle) {
      for (const leaver of leaversByCircle.get(circleId) ?? []) {
        for (const other of members) {
          if (other !== leaver) leftTogether.add(pairKey(leaver, other));
        }
      }
    }
  }

  return { blockedPairs, leftTogether };
}

const zoneNames: Record<string, string> = {
  dhanmondi: "Dhanmondi Weekenders",
  gulshan: "Gulshan Lunch Club",
  mirpur: "Mirpur Mates",
  uttara: "Uttara Outdoors",
};

function circleName(zone: string): string {
  const known = zoneNames[zone];
  if (known) return known;
  const pretty = zone.charAt(0).toUpperCase() + zone.slice(1);
  return `${pretty} Circle`;
}
