import { getTranslations } from "next-intl/server";
import { ArrowRight, Clock3, MapPin, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireOnboarded } from "@/lib/session";
import { getMyCircle } from "@/lib/queries/circles";
import { PageHeader } from "@/components/features/shared/page-header";
import { EmptyState } from "@/components/features/shared/empty-state";
import { CircleRequestForm } from "@/components/features/circles/circle-request-form";
import { CircleInviteActions } from "@/components/features/circles/circle-invite-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeUp } from "@/components/motion";
import { formatDateTime } from "@/lib/dates";

export async function generateMetadata() {
  const t = await getTranslations("circles");
  return { title: t("title") };
}

export default async function CirclesPage() {
  const user = await requireOnboarded();
  const [t, circle, te] = await Promise.all([
    getTranslations("circles"),
    getMyCircle(user.id),
    getTranslations("errors"),
  ]);

  const visibleMembers = circle
    ? circle.members.filter(
        (member) => member.membership.status === "active" || member.membership.status === "invited",
      )
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} subtitle={t("timePollHint")} />

      {circle ? (
        <FadeUp>
          <Card className="overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{circle.circle.name}</CardTitle>
                <Badge variant={circle.circle.status === "active" ? "success" : "secondary"}>
                  {t(`status.${circle.circle.status}`)}
                </Badge>
                {circle.circle.womenOnly ? (
                  <Badge variant="outline">{t("title")} · women only</Badge>
                ) : null}
              </div>
              <p className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="size-4" aria-hidden />
                  {t("memberCount", { count: visibleMembers.length })}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden />
                  {circle.circle.zone}
                </span>
              </p>
            </CardHeader>

            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex -space-x-2">
                {visibleMembers.slice(0, 6).map((member) => (
                  <Avatar key={member.membership.id} className="size-10 border-2 border-background">
                    {member.user.avatarUrl ? (
                      <AvatarImage src={member.user.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback>{member.user.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                ))}
              </div>

              {circle.myMembership?.membership.status === "invited" ? (
                <div className="w-full space-y-2 sm:w-auto">
                  <p className="text-sm text-muted-foreground">{t("inviteText")}</p>
                  <CircleInviteActions circleId={circle.circle.id} />
                </div>
              ) : (
                <Button asChild>
                  <Link href={`/circles/${circle.circle.id}`}>
                    {t("viewActivity")}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              )}
            </CardContent>

            {circle.circle.status === "forming" ? (
              <CardContent className="border-t border-border pt-4 text-sm text-muted-foreground">
                {t("formingNotice")}
              </CardContent>
            ) : null}

            {circle.nextActivities.length ? (
              <CardContent className="border-t border-border pt-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Clock3 className="size-4 text-primary" aria-hidden />
                  {t("nextActivity")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {circle.nextActivities[0].activity.title} ·{" "}
                  {formatDateTime(circle.nextActivities[0].activity.startsAt, user.locale)}
                </p>
              </CardContent>
            ) : null}
          </Card>
        </FadeUp>
      ) : (
        <EmptyState
          icon={Users}
          title={t("noTitle")}
          text={t("noText")}
          actionLabel={te("backHome")}
          actionHref="/home"
        />
      )}

      <Card>
        <CardContent className="pt-6">
          <CircleRequestForm />
        </CardContent>
      </Card>
    </div>
  );
}
