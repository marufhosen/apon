"use server";

import { z } from "zod";
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { activities, hostApplications, rsvps, users, venues } from "@/lib/db/schema";
import {
  activityFormSchema,
  checkinSchema,
  hostApplicationSchema,
  updateActivitySchema,
} from "@/lib/validations";
import { sendHostApprovalEmail } from "@/lib/email";
import { cleanupReplacedImage, resolveOwnedAttachment, resolveOwnedImage } from "@/lib/uploads/server";
import { notify } from "@/lib/notify";
void sendHostApprovalEmail;

function assertHostRole(role: string) {
  if (role !== "host" && role !== "admin") throw new ActionError("errors.unauthorized");
}

/** Apply to become a host. Approved hosts create activities after review. */
export const applyToHost = createAction({
  schema: hostApplicationSchema,
  rateLimit: { key: "report" },
  revalidate: ["/host"],
  handler: async (input, { user }: ActionContext) => {
    if (user.role === "host" || user.role === "admin") {
      throw new ActionError("host.apply.alreadyApproved");
    }

    const existing = await db
      .select()
      .from(hostApplications)
      .where(eq(hostApplications.userId, user.id))
      .limit(1);

    const current = existing[0];
    if (current?.status === "approved") {
      throw new ActionError("host.apply.alreadyApproved");
    }
    if (current?.status === "pending") {
      throw new ActionError("host.apply.pending");
    }

    const attachmentUploadId = await resolveOwnedAttachment(user.id, input.attachmentUploadId, "host_document");

    if (current) {
      await db
        .update(hostApplications)
        .set({ motivation: input.motivation, experience: input.experience, attachmentUploadId, status: "pending" })
        .where(eq(hostApplications.id, current.id));
    } else {
      await db
        .insert(hostApplications)
        .values({ userId: user.id, motivation: input.motivation, experience: input.experience, attachmentUploadId });
    }

    await notify({
      userId: user.id,
      type: "host_approval",
      title: "Application received",
      body: "A real person reviews every application.",
      href: "/host",
      payload: {},
    });

    return { submitted: true };
  },
});

/** Create an activity (starts as `pending` admin approval). */
export const createActivity = createAction({
  schema: activityFormSchema,
  handler: async (input, { user }: ActionContext) => {
    assertHostRole(user.role);

    const venueRows = await db
      .select()
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1);
    const venue = venueRows[0];
    if (!venue || !venue.approved || !venue.isPublic) {
      throw new ActionError("host.form.venueHint", { venueId: ["host.form.venueHint"] });
    }

    const startsAt = new Date(`${input.date}T${input.startTime}:00+06:00`);
    const endsAt = new Date(`${input.date}T${input.endTime}:00+06:00`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new ActionError("errors.validation", { date: ["Invalid date"] });
    }

    const rows = await db
      .insert(activities)
      .values({
        hostId: user.id,
        title: input.title,
        description: input.description,
        categoryInterestId: input.categoryInterestId,
        venueId: venue.id,
        areaId: venue.areaId,
        startsAt,
        endsAt,
        capacity: input.capacity,
        costBdt: input.costBdt,
        imageUrl: await resolveOwnedImage(user.id, input.imageUrl, "activity_cover"),
        womenOnly: input.womenOnly,
        status: "pending",
      })
      .returning();

    const activity = rows[0];
    await notify({
      userId: user.id,
      type: "host_approval",
      title: "Activity submitted",
      body: input.title,
      href: "/host",
      payload: { activityId: activity.id },
    });

    return { activityId: activity.id };
  },
  revalidate: ["/host", "/activities"],
  tags: ["activities"],
});

/** Edit an activity the host owns (admin may edit any). */
export const updateActivity = createAction({
  schema: updateActivitySchema,
  revalidate: (input) => [`/activities/${input.id}`, "/host", "/activities"],
  tags: ["activities"],
  handler: async (input, { user }: ActionContext) => {
    assertHostRole(user.role);

    const venueRows = await db.select().from(venues).where(eq(venues.id, input.venueId)).limit(1);
    const venue = venueRows[0];
    if (!venue || !venue.approved || !venue.isPublic) {
      throw new ActionError("host.form.venueHint", { venueId: ["host.form.venueHint"] });
    }

    const startsAt = new Date(`${input.date}T${input.startTime}:00+06:00`);
    const endsAt = new Date(`${input.date}T${input.endTime}:00+06:00`);

    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(activities)
        .where(eq(activities.id, input.id))
        .for("update")
        .limit(1);
      const activity = rows[0];
      if (!activity) throw new ActionError("errors.notFoundTitle");
      if (activity.hostId !== user.id && user.role !== "admin") {
        throw new ActionError("errors.unauthorized");
      }
      if (activity.status === "cancelled" || activity.status === "completed") {
        throw new ActionError("errors.unauthorized");
      }

      // Capacity can never be reduced below the number of confirmed attendees.
      const [going] = await tx
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(rsvps)
        .where(and(eq(rsvps.activityId, input.id), eq(rsvps.status, "going")));
      if ((going?.count ?? 0) > input.capacity) {
        throw new ActionError("host.form.capacityBelowGoing", {
          capacity: ["host.form.capacityBelowGoing"],
        });
      }

      const nextImage = await resolveOwnedImage(
        user.id,
        input.imageUrl,
        "activity_cover",
        activity.imageUrl,
      );

      await tx
        .update(activities)
        .set({
          title: input.title,
          description: input.description,
          categoryInterestId: input.categoryInterestId,
          venueId: venue.id,
          areaId: venue.areaId,
          startsAt,
          endsAt,
          capacity: input.capacity,
          costBdt: input.costBdt,
          imageUrl: nextImage,
          womenOnly: input.womenOnly,
          // Host edits to a live activity go back into review.
          status: activity.status === "approved" ? "pending" : activity.status,
          updatedAt: new Date(),
        })
        .where(eq(activities.id, input.id));

      return { previousImage: activity.imageUrl, nextImage };
    });

    await cleanupReplacedImage(result.previousImage, result.nextImage);
    return { activityId: input.id };
  },
});

/** Cancel an activity and tell everyone who planned to come. */
export const cancelActivity = createAction({
  // A plain id schema: Zod 4 forbids .pick() on refined schemas (it threw at
  // module load and broke every Server Action on the host pages).
  schema: z.object({ id: z.coerce.number().int().positive() }),
  revalidate: (input) => [`/activities/${input.id}`, "/host", "/activities", "/home"],
  tags: ["activities"],
  handler: async (input, { user }: ActionContext) => {
    assertHostRole(user.role);

    const outcome = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(activities)
        .where(eq(activities.id, input.id))
        .for("update")
        .limit(1);
      const activity = rows[0];
      if (!activity) throw new ActionError("errors.notFoundTitle");
      if (activity.hostId !== user.id && user.role !== "admin") {
        throw new ActionError("errors.unauthorized");
      }
      if (activity.status === "cancelled" || activity.status === "completed") {
        return { activity, attendees: [], cancelled: false };
      }

      const attendees = await tx
        .select({ user: users })
        .from(rsvps)
        .innerJoin(users, eq(rsvps.userId, users.id))
        .where(
          and(eq(rsvps.activityId, input.id), inArray(rsvps.status, ["going", "waitlist"])),
        );

      await tx
        .update(activities)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(activities.id, input.id));

      // Keep the rows for history, but release every seat and the waitlist.
      await tx
        .update(rsvps)
        .set({ status: "cancelled", checkedIn: false, updatedAt: new Date() })
        .where(
          and(eq(rsvps.activityId, input.id), inArray(rsvps.status, ["going", "waitlist"])),
        );

      return { activity, attendees, cancelled: true };
    });

    for (const a of outcome.attendees) {
      await notify({
        userId: a.user.id,
        type: "activity_reminder",
        title: outcome.activity.title,
        body: "Cancelled",
        href: `/activities/${outcome.activity.id}`,
        payload: { activityId: outcome.activity.id, cancelled: true },
      });
    }

    return { cancelled: outcome.cancelled, notified: outcome.attendees.length };
  },
});

/** Mark an attendee as checked in (host or admin only). */
export const toggleCheckin = createAction({
  schema: checkinSchema,
  revalidate: (input) => [`/activities/${input.activityId}`, "/host"],
  handler: async (input, { user }: ActionContext) => {
    assertHostRole(user.role);

    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.id, input.activityId))
      .limit(1);
    const activity = rows[0];
    if (!activity) throw new ActionError("errors.notFoundTitle");
    if (activity.hostId !== user.id && user.role !== "admin") {
      throw new ActionError("errors.unauthorized");
    }

    const rsvpRows = await db
      .select()
      .from(rsvps)
      .where(
        and(
          eq(rsvps.activityId, input.activityId),
          eq(rsvps.userId, input.userId),
          eq(rsvps.status, "going"),
        ),
      )
      .limit(1);

    if (!rsvpRows.length) throw new ActionError("errors.notFoundTitle");

    await db
      .update(rsvps)
      .set({ checkedIn: input.checkedIn, updatedAt: new Date() })
      .where(and(eq(rsvps.activityId, input.activityId), eq(rsvps.userId, input.userId)));

    return { checkedIn: input.checkedIn };
  },
});
