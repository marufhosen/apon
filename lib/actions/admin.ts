"use server";

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { assertSelectableLocation } from "@/lib/queries/locations";
import { cleanupReplacedImage, resolveOwnedImage } from "@/lib/uploads/server";
import {
  activities,
  circleMessages,
  circleRequests,
  hostApplications,
  reports,
  rsvps,
  users,
  venues,
} from "@/lib/db/schema";
import {
  activityReviewSchema,
  adminUserUpdateSchema,
  circleRequestResolutionSchema,
  hostApplicationReviewSchema,
  moderateMessageSchema,
  reportResolutionSchema,
  venueSchema,
} from "@/lib/validations";
import { sendHostApprovalEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { runMatching } from "@/lib/matching";

/** Suspend/restore a member or change their role. */
export const adminUserUpdate = createAction({
  schema: adminUserUpdateSchema,
  authorize: "admin",
  revalidate: ["/admin/users", "/admin"],
  handler: async (input, { user }: ActionContext) => {
    // Admins cannot suspend or demote themselves (prevents locking the
    // last admin out of the Admin Panel).
    if (input.userId === user.id && input.action !== "restore") {
      throw new ActionError("errors.validation");
    }

    const target = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target.length) throw new ActionError("errors.notFoundTitle");

    const patch =
      input.action === "suspend"
        ? { status: "suspended", updatedAt: new Date() }
        : input.action === "restore"
          ? { status: "active", updatedAt: new Date() }
          : { role: input.action, updatedAt: new Date() };

    await db.update(users).set(patch).where(eq(users.id, input.userId));

    if (input.action === "suspend") {
      // Ending their sessions makes the proxy sign them out on the next request.
      await db.execute(sql`delete from sessions where user_id = ${input.userId}`);
    }

    await notify({
      userId: input.userId,
      type: "report_update",
      title: "Your account was updated by an admin",
      body: input.action,
      href: "/home",
      payload: { action: input.action },
    });

    return { updated: true };
  },
});

/** Action or dismiss a report in the queue. */
export const resolveReport = createAction({
  schema: reportResolutionSchema,
  authorize: "admin",
  revalidate: ["/admin/reports", "/admin"],
  handler: async (input, { user }: ActionContext) => {
    const rows = await db.select().from(reports).where(eq(reports.id, input.reportId)).limit(1);
    if (!rows.length) throw new ActionError("errors.notFoundTitle");

    await db
      .update(reports)
      .set({
        status: input.status,
        resolutionNote: input.note || null,
        resolvedBy: user.id,
        resolvedAt: new Date(),
      })
      .where(eq(reports.id, input.reportId));

    await notify({
      userId: rows[0].reporterId,
      type: "report_update",
      title: "Your report was reviewed",
      body: input.status,
      href: "/home",
      payload: { reportId: input.reportId, status: input.status },
    });

    return { status: input.status };
  },
});

/** Hide the exact message named in a report (never the surrounding chat). */
export const hideReportedMessage = createAction({
  schema: moderateMessageSchema,
  authorize: "admin",
  revalidate: ["/admin/reports", "/circles", "/notifications"],
  handler: async (input, { user }: ActionContext) => {
    void user;
    const [message] = await db
      .select({
        id: circleMessages.id,
        circleId: circleMessages.circleId,
        userId: circleMessages.userId,
      })
      .from(circleMessages)
      .where(eq(circleMessages.id, input.messageId))
      .limit(1);
    if (!message) throw new ActionError("errors.notFoundTitle");

    await db
      .update(circleMessages)
      .set({ hiddenAt: new Date() })
      .where(eq(circleMessages.id, input.messageId));

    await notify({
      userId: message.userId,
      type: "report_update",
      title: "A message was hidden by a moderator",
      body: "A message you posted in a circle was hidden after a report.",
      href: `/circles/${message.circleId}`,
      payload: { circleId: message.circleId, messageId: message.id },
    });

    return { hidden: true };
  },
});

/** Approve or reject a host application (grants/reviews the host role). */
export const reviewHostApplication = createAction({
  schema: hostApplicationReviewSchema,
  authorize: "admin",
  revalidate: ["/admin/host-applications", "/admin", "/host"],
  handler: async (input, { user }: ActionContext) => {
    const rows = await db
      .select()
      .from(hostApplications)
      .where(eq(hostApplications.id, input.applicationId))
      .limit(1);
    const application = rows[0];
    if (!application) throw new ActionError("errors.notFoundTitle");

    await db
      .update(hostApplications)
      .set({ status: input.status, reviewedBy: user.id, reviewedAt: new Date() })
      .where(eq(hostApplications.id, input.applicationId));

    const applicantRows = await db
      .select({ id: users.id, email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, application.userId))
      .limit(1);
    const applicant = applicantRows[0];

    if (applicant) {
      if (input.status === "approved") {
        await db.update(users).set({ role: "host", updatedAt: new Date() }).where(eq(users.id, applicant.id));
      }

      await notify({
        userId: applicant.id,
        type: "host_approval",
        title: input.status === "approved" ? "You are a host now" : "Host application update",
        body: input.status,
        href: "/host",
        payload: { status: input.status },
      });

      await sendHostApprovalEmail({
        to: applicant.email,
        locale: applicant.locale,
        approved: input.status === "approved",
      }).catch((err) => console.error("[admin] host email failed", err));
    }

    return { status: input.status };
  },
});

/** Approve / reject / cancel / complete an activity. */
export const reviewActivity = createAction({
  schema: activityReviewSchema,
  authorize: "admin",
  revalidate: (input) => [
    "/admin/activities",
    "/admin",
    "/activities",
    `/activities/${input.activityId}`,
    "/host",
  ],
  tags: ["activities"],
  handler: async (input, { user }: ActionContext) => {
    void user;
    const rows = await db.select().from(activities).where(eq(activities.id, input.activityId)).limit(1);
    const activity = rows[0];
    if (!activity) throw new ActionError("errors.notFoundTitle");

    const allowedFrom: Record<typeof input.action, string[]> = {
      approve: ["pending"],
      reject: ["pending"],
      cancel: ["pending", "approved"],
      complete: ["approved"],
    };
    if (!allowedFrom[input.action].includes(activity.status)) {
      throw new ActionError("errors.validation");
    }

    const status =
      input.action === "approve"
        ? "approved"
        : input.action === "reject" || input.action === "cancel"
          ? "cancelled"
          : "completed";

    await db
      .update(activities)
      .set({
        status,
        updatedAt: new Date(),
        cancellationReason: input.action === "reject" ? "Not approved by admin" : activity.cancellationReason,
      })
      .where(eq(activities.id, input.activityId));

    if (status === "cancelled") {
      const attendees = await db
        .select({ userId: rsvps.userId })
        .from(rsvps)
        .where(
          and(
            eq(rsvps.activityId, input.activityId),
            inArray(rsvps.status, ["going", "waitlist"]),
          ),
        );

      await db
        .update(rsvps)
        .set({ status: "cancelled", checkedIn: false, updatedAt: new Date() })
        .where(
          and(
            eq(rsvps.activityId, input.activityId),
            inArray(rsvps.status, ["going", "waitlist"]),
          ),
        );

      for (const attendee of attendees) {
        await notify({
          userId: attendee.userId,
          type: "activity_reminder",
          title: activity.title,
          body: "Cancelled",
          href: `/activities/${activity.id}`,
          payload: { activityId: activity.id, cancelled: true },
        });
      }
    }

    await notify({
      userId: activity.hostId,
      type: "host_approval",
      title: activity.title,
      body: input.action,
      href: `/activities/${activity.id}`,
      payload: { activityId: activity.id, action: input.action },
    });

    return { status };
  },
});

/** Create or update a venue (approved venues are bookable by hosts). */
export const saveVenue = createAction({
  schema: venueSchema,
  authorize: "admin",
  revalidate: ["/admin/venues", "/admin"],
  handler: async (input, { user }: ActionContext) => {
    await assertSelectableLocation(input.areaId);
    const existing = input.id
      ? (await db.select({ imageUrl: venues.imageUrl }).from(venues).where(eq(venues.id, input.id)).limit(1))[0]
      : undefined;
    const imageUrl = await resolveOwnedImage(user.id, input.imageUrl, "venue_photo", existing?.imageUrl);
    const values = {
      name: input.name,
      areaId: input.areaId,
      address: input.address,
      mapUrl: input.mapUrl || null,
      imageUrl,
      type: input.type,
      isPublic: input.isPublic,
      approved: input.approved,
      updatedAt: new Date(),
    };

    if (input.id) {
      const rows = await db
        .update(venues)
        .set(values)
        .where(eq(venues.id, input.id))
        .returning({ id: venues.id });
      await cleanupReplacedImage(existing?.imageUrl, imageUrl);
      return { id: rows[0]?.id ?? input.id };
    }

    const rows = await db.insert(venues).values(values).returning({ id: venues.id });
    return { id: rows[0]?.id ?? 0 };
  },
});

/** Soft-delete a venue so past activities keep their reference. */
export const deleteVenue = createAction({
  authorize: "admin",
  revalidate: ["/admin/venues", "/admin"],
  handler: async (raw, { user }: ActionContext) => {
    void user;
    const id = Number((raw as { id?: unknown })?.id);
    if (!Number.isFinite(id)) throw new ActionError("errors.validation");

    await db
      .update(venues)
      .set({ deletedAt: new Date(), approved: false, updatedAt: new Date() })
      .where(eq(venues.id, id));

    return { deleted: true };
  },
});

/** Mark a member's rematch request as handled. */
export const resolveCircleRequest = createAction({
  schema: circleRequestResolutionSchema,
  authorize: "admin",
  revalidate: ["/admin/circles", "/admin", "/notifications"],
  handler: async (input, { user }: ActionContext) => {
    void user;
    const rows = await db
      .select()
      .from(circleRequests)
      .where(eq(circleRequests.id, input.requestId))
      .limit(1);
    const request = rows[0];
    if (!request) throw new ActionError("errors.notFoundTitle");
    if (request.status === "handled") return { status: "handled" };

    await db
      .update(circleRequests)
      .set({ status: "handled" })
      .where(eq(circleRequests.id, input.requestId));

    await notify({
      userId: request.userId,
      type: "generic",
      title: "Your rematch request was reviewed",
      body: "We will take it into account in the next matching run.",
      href: "/circles",
      payload: { circleRequestId: input.requestId },
    });

    return { status: "handled" };
  },
});

/** Manual "re-run matching" from the admin circles screen. */
export const rerunMatching = createAction({
  authorize: "admin",
  revalidate: ["/admin/circles", "/admin", "/circles"],
  handler: async () => {
    const result = await runMatching();
    return {
      created: result.groupsCreated,
      pool: result.poolSize,
      members: result.membersInvited,
    };
  },
});
