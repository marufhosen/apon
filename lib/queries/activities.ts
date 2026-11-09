import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, notInArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  activities,
  areas,
  blocks,
  interests,
  rsvps,
  userInterests,
  users,
  venues,
} from "@/lib/db/schema";

export const ACTIVITIES_PAGE_SIZE = 12;

export interface ActivityFilters {
  category?: string;
  area?: string;
  date?: "any" | "week" | "month";
  price?: "any" | "free" | "paid";
  womenOnly?: boolean;
  page?: number;
}

function buildWhere(filters: ActivityFilters): SQL | undefined {
  const now = new Date();
  const conditions: (SQL | undefined)[] = [eq(activities.status, "approved")];

  if (filters.date === "week") {
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    conditions.push(gte(activities.startsAt, now), lte(activities.startsAt, end));
  } else if (filters.date === "month") {
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    conditions.push(gte(activities.startsAt, now), lte(activities.startsAt, end));
  } else {
    conditions.push(gte(activities.startsAt, now));
  }

  if (filters.price === "free") conditions.push(eq(activities.costBdt, 0));
  if (filters.price === "paid") conditions.push(sql`${activities.costBdt} > 0`);
  if (filters.womenOnly) conditions.push(eq(activities.womenOnly, true));

  if (filters.category) {
    conditions.push(sql`${activities.categoryInterestId} = (
      select i.id from interests i where i.slug = ${filters.category}
    )`);
  }
  if (filters.area) {
    // Everything inside the chosen place: "Dhaka division" includes Gulshan 2.
    conditions.push(sql`${activities.areaId} in (
      select l.id from areas l, areas pick
      where pick.slug = ${filters.area}
        and (l.id = pick.id or pick.id = any(l.ancestor_ids))
    )`);
  }

  const defined = conditions.filter((c): c is SQL => Boolean(c));
  return defined.length ? and(...defined) : undefined;
}

export interface ActivityListItem {
  id: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
  costBdt: number;
  capacity: number;
  womenOnly: boolean;
  status: string;
  imageUrl: string | null;
  goingCount: number;
  areaName: string | null;
  areaNameBn: string | null;
  zone: string | null;
  venueName: string | null;
  categoryName: string | null;
  categoryNameBn: string | null;
  categorySlug: string | null;
  hostName: string | null;
  hostAvatar: string | null;
}

export async function listActivities(
  filters: ActivityFilters,
): Promise<{ items: ActivityListItem[]; total: number; pageCount: number; page: number }> {
  const where = buildWhere(filters);
  const page = Math.max(1, filters.page ?? 1);

  const rows = await db
    .select({
      id: activities.id,
      title: activities.title,
      startsAt: activities.startsAt,
      endsAt: activities.endsAt,
      costBdt: activities.costBdt,
      capacity: activities.capacity,
      womenOnly: activities.womenOnly,
      status: activities.status,
      imageUrl: activities.imageUrl,
      areaName: areas.nameEn,
      areaNameBn: areas.nameBn,
      zone: areas.zone,
      venueName: venues.name,
      categoryName: interests.nameEn,
      categoryNameBn: interests.nameBn,
      categorySlug: interests.slug,
      hostName: users.name,
      hostAvatar: users.avatarUrl,
      goingCount: sql<number>`(
        select count(*) from rsvps r
        where r.activity_id = ${activities.id} and r.status = 'going'
      )`.mapWith(Number),
    })
    .from(activities)
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(interests, eq(activities.categoryInterestId, interests.id))
    .leftJoin(users, eq(activities.hostId, users.id))
    .where(where)
    .orderBy(asc(activities.startsAt))
    .limit(ACTIVITIES_PAGE_SIZE)
    .offset((page - 1) * ACTIVITIES_PAGE_SIZE);

  const countRows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(activities)
    .where(where);

  const total = countRows[0]?.count ?? 0;
  return {
    items: rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ACTIVITIES_PAGE_SIZE)),
  };
}

export type ActivityDetail = Awaited<ReturnType<typeof getActivityDetail>>;

/**
 * Full detail for one activity. The exact venue address is only attached when
 * the current user has a confirmed `going` RSVP — this is the only place the
 * address is read server-side.
 */
export async function getActivityDetail(activityId: number, userId?: string) {
  const rows = await db
    .select({
      activity: activities,
      area: areas,
      venue: venues,
      category: interests,
      host: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
        bio: users.bio,
      },
    })
    .from(activities)
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(interests, eq(activities.categoryInterestId, interests.id))
    .innerJoin(users, eq(activities.hostId, users.id))
    .where(eq(activities.id, activityId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const rsvpRows = userId
    ? await db
        .select()
        .from(rsvps)
        .where(and(eq(rsvps.activityId, activityId), eq(rsvps.userId, userId)))
        .limit(1)
    : [];

  const myRsvp = rsvpRows[0] ?? null;

  const goingCount = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(rsvps)
    .where(and(eq(rsvps.activityId, activityId), eq(rsvps.status, "going")));

  const waitlistCount = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(rsvps)
    .where(and(eq(rsvps.activityId, activityId), eq(rsvps.status, "waitlist")));

  const going = goingCount[0]?.count ?? 0;
  const spotsLeft = Math.max(0, row.activity.capacity - going);

  const venue = row.venue;
  const canSeeAddress = Boolean(myRsvp && myRsvp.status === "going");

  return {
    ...row.activity,
    area: row.area,
    category: row.category,
    host: row.host,
    venue: venue
      ? {
          ...venue,
          // Deliberately withheld until the user is confirmed.
          address: canSeeAddress ? venue.address : null,
          mapUrl: canSeeAddress ? venue.mapUrl : null,
        }
      : null,
    myRsvp,
    going,
    waitlist: waitlistCount[0]?.count ?? 0,
    spotsLeft,
    canSeeAddress,
  };
}

/** Activities the user is going to (past and future). */
export async function getMyRsvps(userId: string) {
  const rows = await db
    .select({
      activity: activities,
      rsvp: rsvps,
      venueName: venues.name,
      areaName: areas.nameEn,
      hostName: users.name,
      categoryName: interests.nameEn,
      categorySlug: interests.slug,
    })
    .from(rsvps)
    .innerJoin(activities, eq(rsvps.activityId, activities.id))
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .leftJoin(users, eq(activities.hostId, users.id))
    .leftJoin(interests, eq(activities.categoryInterestId, interests.id))
    .where(and(eq(rsvps.userId, userId), inArray(rsvps.status, ["going", "waitlist"])))
    .orderBy(asc(activities.startsAt));

  return rows;
}

/** Home screen suggestions: same zone + shared interests, not yet RSVP'd. */
export async function getSuggestedActivities(userId: string, areaId: number | null, limit = 6) {
  const myInterestRows = await db
    .select()
    .from(userInterests)
    .where(eq(userInterests.userId, userId));
  const myInterests = new Set(myInterestRows.map((r) => r.interestId));

  const myRsvps = await db
    .select({ activityId: rsvps.activityId })
    .from(rsvps)
    .where(eq(rsvps.userId, userId));
  const excluded = myRsvps.map((r) => r.activityId);

  const rows = await db
    .select({
      activity: activities,
      areaName: areas.nameEn,
      zone: areas.zone,
      categoryName: interests.nameEn,
      categorySlug: interests.slug,
      goingCount: sql<number>`(
        select count(*) from rsvps r where r.activity_id = ${activities.id} and r.status = 'going'
      )`.mapWith(Number),
    })
    .from(activities)
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .leftJoin(interests, eq(activities.categoryInterestId, interests.id))
    .where(
      and(
        eq(activities.status, "approved"),
        gte(activities.startsAt, new Date()),
        excluded.length ? notInArray(activities.id, excluded) : undefined,
      ),
    )
    .orderBy(asc(activities.startsAt))
    .limit(limit * 3);

  const scored = rows.map((r) => ({
    ...r,
    near: areaId !== null && r.activity.areaId === areaId,
    interestMatch:
      r.activity.categoryInterestId !== null && myInterests.has(r.activity.categoryInterestId),
  }));

  return scored
    .sort(
      (a, b) =>
        Number(b.near) - Number(a.near) ||
        Number(b.interestMatch) - Number(a.interestMatch),
    )
    .slice(0, limit);
}

/** Activities that just ended and still need feedback from this user. */
export async function getPendingFeedback(userId: string) {
  const rows = await db
    .select({
      activity: activities,
      venueName: venues.name,
      circleId: activities.circleId,
    })
    .from(rsvps)
    .innerJoin(activities, eq(rsvps.activityId, activities.id))
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .where(
      and(
        eq(rsvps.userId, userId),
        eq(rsvps.status, "going"),
        eq(activities.status, "completed"),
        lte(activities.endsAt, new Date()),
        sql`not exists (
          select 1 from feedback f
          where f.user_id = ${userId} and f.activity_id = ${activities.id}
        )`,
      ),
    )
    .orderBy(desc(activities.endsAt))
    .limit(3);

  return rows;
}

/** Everything the host has created. */
export async function getHostActivities(hostId: string) {
  return db
    .select({
      activity: activities,
      venueName: venues.name,
      areaName: areas.nameEn,
      goingCount: sql<number>`(
        select count(*) from rsvps r where r.activity_id = ${activities.id} and r.status = 'going'
      )`.mapWith(Number),
      waitlistCount: sql<number>`(
        select count(*) from rsvps r where r.activity_id = ${activities.id} and r.status = 'waitlist'
      )`.mapWith(Number),
    })
    .from(activities)
    .leftJoin(venues, eq(activities.venueId, venues.id))
    .leftJoin(areas, eq(activities.areaId, areas.id))
    .where(eq(activities.hostId, hostId))
    .orderBy(desc(activities.startsAt));
}

export interface Attendee {
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  checkedIn: boolean;
}

/**
 * Attendee list, scoped to the viewer.
 *
 * Hosts and admins see every RSVP (including waitlist/cancelled) for check-in.
 * A confirmed attendee sees only the other confirmed attendees. Everyone else
 * gets no identities at all — the public count already comes from
 * `getActivityDetail`.
 */
export async function getActivityAttendees(
  activityId: number,
  viewerId: string,
  viewerRole: string,
): Promise<Attendee[]> {
  const [activity] = await db
    .select({ hostId: activities.hostId })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);
  if (!activity) return [];

  const privileged = viewerRole === "admin" || activity.hostId === viewerId;
  if (!privileged) {
    const [mine] = await db
      .select({ status: rsvps.status })
      .from(rsvps)
      .where(and(eq(rsvps.activityId, activityId), eq(rsvps.userId, viewerId)))
      .limit(1);
    if (mine?.status !== "going") return [];
  }

  const rows = await db
    .select({
      userId: rsvps.userId,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: rsvps.status,
      checkedIn: rsvps.checkedIn,
    })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(
      and(
        eq(rsvps.activityId, activityId),
        privileged ? undefined : eq(rsvps.status, "going"),
      ),
    )
    .orderBy(asc(rsvps.status), asc(users.name));

  // Never reveal someone the viewer blocked (or who blocked the viewer).
  const blockRows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, viewerId)));
  const blockedIds = new Set(
    blockRows.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId)),
  );

  return rows.filter((row) => !blockedIds.has(row.userId));
}

/** Venues a host may book — approved and public only. */
export async function getBookableVenues() {
  return db
    .select()
    .from(venues)
    .where(and(eq(venues.approved, true), eq(venues.isPublic, true)))
    .orderBy(asc(venues.name));
}
