import "server-only";

import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { cache } from "react";

import { db } from "@/lib/db";
import {
  activities,
  areas,
  circleMessages,
  circleRequests,
  circles,
  hostApplications,
  reports,
  users,
  venues,
} from "@/lib/db/schema";

/**
 * Runs a single-row aggregate query and returns it (or undefined).
 *
 * The cast is on `execute`'s row mapping only — the driver hands back plain
 * row objects, and the generic is what the SQL aliases promise.
 */
async function scalar<T extends Record<string, unknown>>(query: SQL): Promise<T | undefined> {
  const rows = await db.execute<T>(query);
  return rows[0] as T | undefined;
}

/** Every number on the admin dashboard. */
export async function getAdminOverview() {
  const [totals, recentSignups] = await Promise.all([
    scalar<{
      totalUsers: number;
      newThisWeek: number;
      upcomingActivities: number;
      openReports: number;
      activeCircles: number;
      pendingActivities: number;
      pendingApplications: number;
      pendingRequests: number;
    }>(sql`
      select
        (select count(*)::int from users where deleted_at is null) as "totalUsers",
        (select count(*)::int from users where deleted_at is null and created_at >= now() - interval '7 days') as "newThisWeek",
        (select count(*)::int from activities where status = 'approved' and starts_at > now()) as "upcomingActivities",
        (select count(*)::int from reports where status = 'open') as "openReports",
        (select count(*)::int from circles where status = 'active' and deleted_at is null) as "activeCircles",
        (select count(*)::int from activities where status = 'pending') as "pendingActivities",
        (select count(*)::int from host_applications where status = 'pending') as "pendingApplications",
        (select count(*)::int from circle_requests where status = 'open') as "pendingRequests"
    `),
    db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
        status: users.status,
        onboardedAt: users.onboardedAt,
        areaName: areas.nameEn,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(areas, eq(users.areaId, areas.id))
      .where(sql`${users.deletedAt} is null`)
      .orderBy(desc(users.createdAt))
      .limit(8),
  ]);

  return {
    totals: totals ?? {
      totalUsers: 0,
      newThisWeek: 0,
      upcomingActivities: 0,
      openReports: 0,
      activeCircles: 0,
      pendingActivities: 0,
      pendingApplications: 0,
      pendingRequests: 0,
    },
    recentSignups,
  };
}

/** User management list, with an optional search across name/email/phone. */
export async function listAdminUsers(search?: string) {
  const term = search?.trim();

  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phoneNumber: users.phoneNumber,
      phoneNumberVerified: users.phoneNumberVerified,
      role: users.role,
      status: users.status,
      onboardedAt: users.onboardedAt,
      createdAt: users.createdAt,
      areaName: areas.nameEn,
    })
    .from(users)
    .leftJoin(areas, eq(users.areaId, areas.id))
    .where(
      and(
        sql`${users.deletedAt} is null`,
        term
          ? or(
              ilike(users.name, `%${term}%`),
              ilike(users.email, `%${term}%`),
              ilike(users.phoneNumber, `%${term}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(100);
}

/** Moderation queue. */
export async function listReports(status: "open" | "actioned" | "dismissed" = "open") {
  return db
    .select({
      report: reports,
      reporterName: users.name,
    })
    .from(reports)
    .leftJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.status, status))
    .orderBy(desc(reports.createdAt))
    .limit(100);
}

export type ReportTarget =
  | {
      kind: "message";
      id: number;
      body: string;
      hiddenAt: Date | null;
      createdAt: Date;
      authorId: string;
      authorName: string;
      circleId: number;
      circleName: string;
    }
  | {
      kind: "activity";
      id: number;
      title: string;
      status: string;
      startsAt: Date;
      hostName: string;
    }
  | {
      kind: "user";
      id: string;
      name: string;
      username: string | null;
      status: string;
      createdAt: Date;
    }
  | { kind: "missing"; targetType: string; targetId: string };

/**
 * Strictly loads the entity a report points at. Only this one item is exposed
 * to the admin; the rest of a reported circle's chat stays private.
 */
export async function getReportTarget(report: {
  targetType: string;
  targetId: string;
}): Promise<ReportTarget> {
  const id = Number(report.targetId);

  if (report.targetType === "message" && Number.isInteger(id)) {
    const [row] = await db
      .select({
        id: circleMessages.id,
        body: circleMessages.body,
        hiddenAt: circleMessages.hiddenAt,
        createdAt: circleMessages.createdAt,
        authorId: users.id,
        authorName: users.name,
        circleId: circles.id,
        circleName: circles.name,
      })
      .from(circleMessages)
      .innerJoin(users, eq(circleMessages.userId, users.id))
      .innerJoin(circles, eq(circleMessages.circleId, circles.id))
      .where(eq(circleMessages.id, id))
      .limit(1);
    if (row) return { kind: "message", ...row };
  }

  if (report.targetType === "activity" && Number.isInteger(id)) {
    const [row] = await db
      .select({
        id: activities.id,
        title: activities.title,
        status: activities.status,
        startsAt: activities.startsAt,
        hostName: users.name,
      })
      .from(activities)
      .innerJoin(users, eq(activities.hostId, users.id))
      .where(eq(activities.id, id))
      .limit(1);
    if (row) return { kind: "activity", ...row };
  }

  if (report.targetType === "user") {
    const [row] = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.displayUsername,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, report.targetId))
      .limit(1);
    if (row) return { kind: "user", ...row };
  }

  return { kind: "missing", targetType: report.targetType, targetId: report.targetId };
}

/** Host applications awaiting review (or already reviewed). */
export async function listHostApplications(
  status: "pending" | "approved" | "rejected" = "pending",
) {
  return db
    .select({
      application: hostApplications,
      userId: users.id,
      userName: users.name,
      userAvatarUrl: users.avatarUrl,
    })
    .from(hostApplications)
    .innerJoin(users, eq(hostApplications.userId, users.id))
    .where(eq(hostApplications.status, status))
    .orderBy(desc(hostApplications.createdAt))
    .limit(100);
}

/** Activities filtered by moderation state. */
export async function listAdminActivities(
  status: "pending" | "approved" | "cancelled" | "completed" = "pending",
) {
  return db
    .select({
      activity: activities,
      hostName: users.name,
      hostId: users.id,
      venueName: venues.name,
      areaName: areas.nameEn,
      goingCount: sql<number>`(
        select count(*) from rsvps r where r.activity_id = ${activities.id} and r.status = 'going'
      )`.mapWith(Number),
    })
    .from(activities)
    .innerJoin(users, eq(activities.hostId, users.id))
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .where(eq(activities.status, status))
    .orderBy(desc(activities.startsAt))
    .limit(100);
}

/** All venues with their area, for CRUD. */
export async function listAllVenues() {
  return db
    .select({
      venue: venues,
      areaName: areas.nameEn,
      areaNameBn: areas.nameBn,
    })
    .from(venues)
    .leftJoin(areas, eq(venues.areaId, areas.id))
    .orderBy(desc(venues.createdAt))
    .limit(200);
}

/** Open rematch requests, with the member who asked. */
export async function listOpenCircleRequests() {
  return db
    .select({
      id: circleRequests.id,
      userId: circleRequests.userId,
      reason: circleRequests.reason,
      createdAt: circleRequests.createdAt,
      userName: users.name,
    })
    .from(circleRequests)
    .innerJoin(users, eq(circleRequests.userId, users.id))
    .where(eq(circleRequests.status, "open"))
    .orderBy(desc(circleRequests.createdAt))
    .limit(50);
}

/**
 * The metrics page.
 *
 * North star: members who have met the *same* circle 3+ times — the only
 * number that proves recurring circles are actually working.
 */
export async function getAdminMetrics() {
  const row = await scalar<{
    onboardingCount: number;
    attendedCount: number;
    repeatCount: number;
    feedbackCount: number;
    wantAgainCount: number;
    avgComfort: number | null;
    medianDaysToCircle: number | null;
    sameCircleThrice: number;
  }>(sql`
    select
      (select count(*)::int from users
        where onboarded_at is not null and deleted_at is null) as "onboardingCount",
      (select count(distinct user_id)::int from rsvps where checked_in) as "attendedCount",
      (select count(*)::int from (
        select user_id from rsvps where checked_in group by user_id having count(*) >= 2
      ) t) as "repeatCount",
      (select count(*)::int from feedback) as "feedbackCount",
      (select count(*)::int from feedback where want_to_meet_again) as "wantAgainCount",
      (select round(avg(comfortable)::numeric, 2)::float from feedback) as "avgComfort",
      (select percentile_cont(0.5) within group (
          order by extract(epoch from (cm.joined_at - u.created_at)) / 86400
        )::float
        from circle_members cm
        join users u on u.id = cm.user_id
        where cm.status in ('active', 'invited')) as "medianDaysToCircle",
      (select count(*)::int from (
        select a.circle_id, r.user_id
        from rsvps r
        join activities a on a.id = r.activity_id
        where r.checked_in and a.circle_id is not null
        group by a.circle_id, r.user_id
        having count(*) >= 3
      ) t) as "sameCircleThrice"
  `);

  const onboardingCount = row?.onboardingCount ?? 0;
  const attendedCount = row?.attendedCount ?? 0;
  const feedbackCount = row?.feedbackCount ?? 0;

  return {
    signupToMeetupRate: onboardingCount ? attendedCount / onboardingCount : null,
    repeatRate: attendedCount ? (row?.repeatCount ?? 0) / attendedCount : null,
    wantAgainRate: feedbackCount ? (row?.wantAgainCount ?? 0) / feedbackCount : null,
    avgComfort: row?.avgComfort ?? null,
    medianDaysToCircle: row?.medianDaysToCircle ?? null,
    northStar: row?.sameCircleThrice ?? 0,
    totals: { onboardingCount, attendedCount, feedbackCount },
  };
}

/** Work-queue counts for the admin sidebar badges. */
export const getAdminQueueCounts = cache(async () => {
  const row = await scalar<{
    openReports: number;
    pendingApplications: number;
    pendingActivities: number;
    openRequests: number;
  }>(sql`
    select
      (select count(*)::int from reports where status = 'open') as "openReports",
      (select count(*)::int from host_applications where status = 'pending') as "pendingApplications",
      (select count(*)::int from activities where status = 'pending') as "pendingActivities",
      (select count(*)::int from circle_requests where status = 'open') as "openRequests"
  `);
  return row ?? { openReports: 0, pendingApplications: 0, pendingActivities: 0, openRequests: 0 };
});

/** Members and venues per division (admin overview "where are members"). */
export async function getMembersByDivision() {
  const rows = await db.execute<{ id: number; nameEn: string; nameBn: string; members: number; venues: number }>(sql`
    select d.id, d.name_en as "nameEn", d.name_bn as "nameBn",
      (select count(*)::int from users u join areas a on a.id = u.area_id
        where u.deleted_at is null and (a.id = d.id or d.id = any(a.ancestor_ids))) as "members",
      (select count(*)::int from venues v join areas a on a.id = v.area_id
        where v.deleted_at is null and (a.id = d.id or d.id = any(a.ancestor_ids))) as "venues"
    from areas d
    where d.level = 'division'
    order by "members" desc, d.name_en
  `);
  return [...rows];
}

/** Role and status breakdown for the overview. */
export async function getRoleBreakdown() {
  const rows = await db.execute<{ role: string; count: number }>(sql`
    select role, count(*)::int as count from users where deleted_at is null group by role
  `);
  return Object.fromEntries([...rows].map((r) => [r.role, r.count])) as Record<string, number>;
}
