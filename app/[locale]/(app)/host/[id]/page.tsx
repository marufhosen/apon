import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, MapPin, Pencil, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireHost, requireOnboarded } from "@/lib/session";
import { getHostActivity } from "@/lib/queries/host";
import { getActivityAttendees } from "@/lib/queries/activities";
import { PageHeader } from "@/components/features/shared/page-header";
import { AttendeeList } from "@/components/features/host/attendee-list";
import { CancelActivityButton } from "@/components/features/host/cancel-activity-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeUp } from "@/components/motion";
import { formatDateTime } from "@/lib/dates";

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> =
  {
    pending: "warning",
    approved: "success",
    cancelled: "destructive",
    completed: "secondary",
  };

export default async function HostActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireHost();
  const user = await requireOnboarded();
  const { id } = await params;
  const activityId = Number(id);
  if (!Number.isInteger(activityId) || activityId <= 0) notFound();

  const row = await getHostActivity(activityId);
  if (!row) notFound();
  if (row.activity.hostId !== user.id && user.role !== "admin") notFound();

  const [t, th, attendees] = await Promise.all([
    getTranslations("activities.checkin"),
    getTranslations("host"),
    getActivityAttendees(activityId, user.id, user.role),
  ]);

  const { activity, venue, area } = row;
  const canCancel = activity.status === "pending" || activity.status === "approved";

  return (
    <div className="space-y-5">
      <PageHeader
        title={activity.title}
        subtitle={`${th(`status.${activity.status}`)} · ${formatDateTime(activity.startsAt, user.locale)}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/host/${activity.id}/edit`}>
                <Pencil aria-hidden />
                {th("dashboard.edit")}
              </Link>
            </Button>
            {canCancel ? <CancelActivityButton activityId={activity.id} /> : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[activity.status]}>
          {th(`status.${activity.status}`)}
        </Badge>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden />
          {venue?.name ?? "—"}
          {area ? ` · ${area.nameEn}` : ""}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden />
          {activity.capacity}
        </span>
      </div>

      <FadeUp>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-primary" aria-hidden />
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttendeeList
              activityId={activity.id}
              attendees={attendees.map((a) => ({
                userId: a.userId,
                name: a.name,
                avatarUrl: a.avatarUrl,
                status: a.status,
                checkedIn: a.checkedIn,
              }))}
            />
          </CardContent>
        </Card>
      </FadeUp>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{activity.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p className="whitespace-pre-wrap">{activity.description}</p>
          <p>
            {formatDateTime(activity.startsAt, user.locale)} —{" "}
            {formatDateTime(activity.endsAt, user.locale)}
          </p>
          {venue ? (
            <p>
              {venue.name} · {venue.address}
            </p>
          ) : null}
          <p>{activity.costBdt === 0 ? "Free" : `${activity.costBdt} ৳`}</p>
        </CardContent>
      </Card>
    </div>
  );
}
