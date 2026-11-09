import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  BadgeCheck,
  CalendarDays,
  Coins,
  Lock,
  MapPin,
  Navigation,
  Users,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { activityCover } from "@/lib/images";
import { formatDateTime } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { getActivityAttendees, getActivityDetail } from "@/lib/queries/activities";
import { db } from "@/lib/db";
import { feedback } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { BLUR_DATA_URL } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { RsvpButton } from "@/components/features/activities/rsvp-button";
import { FeedbackForm } from "@/components/features/activities/feedback-form";
import { ReportButton } from "@/components/features/shared/report-button";
import { FadeUp } from "@/components/motion";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ feedback?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const activity = await getActivityDetail(Number(id));
  return { title: activity?.title ?? "Activity" };
}

export default async function ActivityDetailPage({ params, searchParams }: Props) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) notFound();

  const [activity, t, tFb] = await Promise.all([
    getActivityDetail(activityId, user?.id),
    getTranslations("activities"),
    getTranslations("feedback"),
  ]);
  if (!activity) notFound();

  const locale = user?.locale ?? "en";
  const cover = activity.category?.slug ? activityCover(activity.category.slug) : activityCover();
  const now = new Date();
  const started = activity.startsAt <= now;
  const isHost = user && (user.id === activity.host.id || user.role === "admin");
  const myStatus =
    activity.myRsvp && activity.myRsvp.status !== "cancelled"
      ? (activity.myRsvp.status as "going" | "waitlist")
      : null;

  const canRsvp =
    Boolean(user) &&
    activity.status === "approved" &&
    !started &&
    user?.status === "active";

  const needsPhone = Boolean(user) && !user?.phoneNumberVerified;

  // Only the host, admins and confirmed attendees may see who else is coming.
  const attendees =
    user && (isHost || myStatus === "going")
      ? await getActivityAttendees(activityId, user.id, user.role)
      : [];

  // Private feedback: only for people who actually attended.
  let myFeedback: (typeof feedback.$inferSelect) | null = null;
  if (user && myStatus === "going") {
    const rows = await db
      .select()
      .from(feedback)
      .where(and(eq(feedback.userId, user.id), eq(feedback.activityId, activityId)))
      .limit(1);
    myFeedback = rows[0] ?? null;
  }

  const showFeedback =
    Boolean(user) &&
    activity.status === "completed" &&
    myStatus === "going" &&
    (query.feedback === "1" || !myFeedback);

  return (
    <div className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/activities">← {t("detail.backToList")}</Link>
        </Button>

        <FadeUp className="relative overflow-hidden rounded-2xl border border-border">
          <div className="relative h-48 bg-gradient-to-br from-primary/40 via-primary/15 to-muted sm:h-60">
            <Image
              src={activity.imageUrl ?? cover.src}
              alt={cover.alt}
              fill
              priority
              placeholder="blur"
              blurDataURL={BLUR_DATA_URL}
              sizes="(max-width: 1024px) 100vw, 960px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          </div>

          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <div className="mb-3 flex flex-wrap gap-2">
              {activity.category ? <Badge className="bg-card/95 text-primary">{activity.category.nameEn}</Badge> : null}
              {activity.womenOnly ? <Badge variant="secondary" className="bg-card/95">{t("filters.womenOnly")}</Badge> : null}
              <Badge variant={activity.costBdt === 0 ? "success" : "default"} className="bg-card/95">
                {activity.costBdt === 0 ? t("detail.costFree") : `${activity.costBdt} ৳`}
              </Badge>
              {activity.status !== "approved" ? (
                <Badge variant="warning">
                  {activity.status === "pending"
                    ? t("detail.pending")
                    : activity.status === "cancelled"
                      ? t("detail.cancelled")
                      : t("detail.completed")}
                </Badge>
              ) : null}
            </div>
            <h1 className="max-w-3xl text-xl font-semibold text-white drop-shadow sm:text-2xl">
              {activity.title}
            </h1>
          </div>
        </FadeUp>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------------------ Main */}
        <div className="space-y-6 lg:col-span-2">
          <FadeUp>
            <Card>
              <CardHeader>
                <CardTitle>{t("detail.about")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 text-sm leading-relaxed text-muted-foreground">
                <p className="whitespace-pre-line">{activity.description}</p>

                <dl className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <div className="flex gap-3">
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div>
                      <dt className="font-medium text-foreground">{t("detail.when")}</dt>
                      <dd className="mt-0.5">
                        {formatDateTime(activity.startsAt, locale)}
                        <br />
                        → {formatDateTime(activity.endsAt, locale)}
                      </dd>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div>
                      <dt className="font-medium text-foreground">{t("detail.where")}</dt>
                      <dd className="mt-0.5">
                        {activity.area?.nameEn ?? "—"}
                        {activity.venue ? <><br />{activity.venue.name}</> : null}
                      </dd>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Users className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div>
                      <dt className="font-medium text-foreground">{t("detail.spots")}</dt>
                      <dd className="mt-0.5">
                        {t("detail.capacity", {
                          going: activity.going,
                          capacity: activity.capacity,
                        })}
                      </dd>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Coins className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div>
                      <dt className="font-medium text-foreground">{t("detail.cost")}</dt>
                      <dd className="mt-0.5">
                        {activity.costBdt === 0
                          ? t("detail.costFree")
                          : t("detail.costAtVenue", { amount: activity.costBdt })}
                      </dd>
                    </div>
                  </div>
                </dl>

                {/* Exact address: only for confirmed RSVPs. */}
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    {activity.canSeeAddress ? (
                      <MapPin className="size-4 text-primary" aria-hidden />
                    ) : (
                      <Lock className="size-4 text-muted-foreground" aria-hidden />
                    )}
                    {t("detail.address")}
                  </p>

                  {activity.canSeeAddress && activity.venue ? (
                    <div className="mt-2 space-y-2 text-muted-foreground">
                      <p>{activity.venue.address}</p>
                      {activity.venue.mapUrl ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={activity.venue.mapUrl} target="_blank" rel="noreferrer noopener">
                            <Navigation aria-hidden /> {t("detail.map")}
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2">
                      <p className="text-sm font-medium">{t("detail.addressLocked")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("detail.addressLockedText")}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </FadeUp>

          {/* ------------------------------------------------------ Feedback */}
          {showFeedback ? (
            <FadeUp>
              <Card>
                <CardHeader>
                  <CardTitle>{tFb("title", { title: activity.title })}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FeedbackForm
                    activityId={activityId}
                    title={activity.title}
                    alreadySubmitted={Boolean(myFeedback)}
                  />
                </CardContent>
              </Card>
            </FadeUp>
          ) : null}
        </div>

        {/* ---------------------------------------------------------- Aside */}
        <aside className="space-y-6">
          <FadeUp>
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("detail.spots")}</span>
                  <span className="font-semibold">
                    {activity.spotsLeft > 0
                      ? t("detail.spotsLeft", { count: activity.spotsLeft })
                      : t("detail.full")}
                  </span>
                </div>

                {activity.status === "cancelled" ? (
                  <Alert variant="destructive">{t("detail.cancelled")}</Alert>
                ) : activity.status === "pending" && !isHost ? (
                  <Alert variant="warning">{t("detail.pending")}</Alert>
                ) : started && activity.status === "approved" ? (
                  <Alert variant="info">{t("detail.completed")}</Alert>
                ) : (
                  <RsvpButton
                    activityId={activityId}
                    status={myStatus}
                    full={activity.spotsLeft === 0 && myStatus === null}
                    disabled={!canRsvp || Boolean(needsPhone && !myStatus)}
                    disabledLabel={
                      !user
                        ? t("detail.signInToJoin")
                        : needsPhone
                          ? t("detail.verifyPhoneToJoin")
                          : undefined
                    }
                    disabledReason={
                      user && !user.onboardedAt ? t("detail.verifyPhoneToJoin") : undefined
                    }
                  />
                )}

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("detail.hostedBy", { name: activity.host.name ?? "" })}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <Avatar className="size-10">
                      {activity.host.avatarUrl ? (
                        <AvatarImage src={activity.host.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback>{(activity.host.name ?? "?").slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 truncate text-sm font-medium">
                        {activity.host.name}
                        <BadgeCheck className="size-4 text-primary" aria-hidden />
                      </p>
                      <Link
                        href={`/profile/${activity.host.id}`}
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {t("detail.organiserNote")}
                      </Link>
                    </div>
                  </div>

                  {user && activity.host.id && user.id !== activity.host.id ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-xs text-muted-foreground">{t("detail.somethingWrong")}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <ReportButton targetType="activity" targetId={activityId} variant="ghost" />
                        <ReportButton
                          targetType="user"
                          targetId={activity.host.id}
                          variant="ghost"
                          label={t("detail.reportHost")}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </FadeUp>
        </aside>
      </div>

      {/* ------------------------------------------------- Other attendees */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">
          {t("checkin.title")} · {t("detail.capacity", { going: activity.going, capacity: activity.capacity })}
        </h2>
        {attendees.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {attendees.map((attendee) => (
              <li
                key={attendee.userId}
                className="flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-3.5 text-sm"
              >
                <Avatar className="size-7">
                  {attendee.avatarUrl ? <AvatarImage src={attendee.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{attendee.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                {attendee.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("checkin.empty")}</p>
        )}
      </section>
    </div>
  );
}
