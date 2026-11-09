import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, MapPin, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireOnboarded } from "@/lib/session";
import { getCircleBundle, getCircleMembership } from "@/lib/queries/circles";
import { getBlockedIds } from "@/lib/queries/users";
import { getMyReportedIds } from "@/lib/queries/safety";
import { PageHeader } from "@/components/features/shared/page-header";
import { PollCard } from "@/components/features/circles/poll-card";
import { CreatePollForm } from "@/components/features/circles/create-poll-form";
import { MessageThread } from "@/components/features/circles/message-thread";
import { LeaveCircleButton } from "@/components/features/circles/leave-circle-button";
import { CircleInviteActions } from "@/components/features/circles/circle-invite-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeUp, Stagger, StaggerItem } from "@/components/motion";
import { formatDate, formatDateTime } from "@/lib/dates";

/** Circle pages are private: everything here is gated on an active membership. */
export default async function CircleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOnboarded();
  const { id } = await params;
  const circleId = Number(id);
  if (!Number.isInteger(circleId) || circleId <= 0) notFound();

  const membership = await getCircleMembership(circleId, user.id);
  if (!membership || membership.status === "left" || membership.status === "declined") {
    notFound();
  }

  const [bundle, blockedIds, reportedMessageIds, t] = await Promise.all([
    getCircleBundle(circleId, membership.id, user.id),
    getBlockedIds(user.id),
    getMyReportedIds(user.id, "message"),
    getTranslations("circles"),
  ]);

  if (!bundle) notFound();

  const { circle, members, nextActivities, poll, messages } = bundle;
  if (circle.status === "archived") notFound();

  const accepted = membership.status === "active";
  const activeMembers = members.filter((m) => m.membership.status === "active");
  const visibleMembers = members.filter(
    (m) =>
      (m.membership.status === "active" || m.membership.status === "invited") &&
      !blockedIds.has(m.user.id),
  );

  const thread = messages
    .filter((row) => !blockedIds.has(row.user.id))
    .map((row) => ({
      id: row.message.id,
      body: row.message.body,
      createdAt: row.message.createdAt,
      authorId: row.user.id,
      authorName: row.user.name,
      authorAvatar: row.user.avatarUrl,
      // Moderator-hidden, or hidden from me because I reported it.
      hidden: Boolean(row.message.hiddenAt) || reportedMessageIds.has(String(row.message.id)),
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={circle.name}
        subtitle={t("timePollHint")}
        actions={
          accepted ? (
            <LeaveCircleButton circleId={circle.id} />
          ) : (
            <CircleInviteActions circleId={circle.id} />
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={circle.status === "active" ? "success" : "secondary"}>
          {t(`status.${circle.status}`)}
        </Badge>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden />
          {circle.zone}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden />
          {t("memberCount", { count: activeMembers.length })}
        </span>
      </div>

      {!accepted ? (
        <FadeUp>
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base">{t("inviteTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("inviteText")}</p>
              <CircleInviteActions circleId={circle.id} />
            </CardContent>
          </Card>
        </FadeUp>
      ) : circle.status === "forming" ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {t("formingNotice")}
        </p>
      ) : null}

      {/* ------------------------------------------------------------- Members */}
      <FadeUp>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("members")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stagger className="grid gap-3 sm:grid-cols-2">
              {visibleMembers.map((member) => (
                <StaggerItem key={member.membership.id}>
                  <Link
                    href={`/profile/${member.user.id}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
                  >
                    <Avatar className="size-10">
                      {member.user.avatarUrl ? (
                        <AvatarImage src={member.user.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback>
                        {member.user.name.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {member.user.name}
                        {member.user.id === user.id ? " (you)" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(member.membership.createdAt, user.locale)}
                      </p>
                    </div>
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          </CardContent>
        </Card>
      </FadeUp>

      {/* ----------------------------------------------------------- Next meet */}
      {nextActivities.length ? (
        <FadeUp>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4 text-primary" aria-hidden />
                {t("nextActivity")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {nextActivities.map((row) => (
                <div
                  key={row.activity.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{row.activity.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(row.activity.startsAt, user.locale)}
                      {row.areaName ? ` · ${row.areaName}` : ""}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/activities/${row.activity.id}`}>{t("viewActivity")}</Link>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </FadeUp>
      ) : null}

      {/* --------------------------------------------------------------- Poll */}
      {!accepted ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {t("joinToParticipate")}
        </p>
      ) : poll ? (
        <FadeUp className="space-y-3">
          <PollCard
            poll={{ id: poll.poll.id, title: poll.poll.title, status: poll.poll.status }}
            options={poll.options.map((o) => ({
              id: o.id,
              label: o.label,
              voteCount: o.voteCount,
              votedByMe: o.votedByMe,
            }))}
            totalVotes={poll.totalVotes}
            myVoteCount={poll.myVoteCount}
          />
          <div className="flex justify-end">
            <CreatePollForm circleId={circle.id} />
          </div>
        </FadeUp>
      ) : (
        <FadeUp className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">{t("timePoll")}</p>
          <CreatePollForm circleId={circle.id} />
        </FadeUp>
      )}

      {/* ------------------------------------------------------------ Comments */}
      {accepted ? (
        <MessageThread circleId={circle.id} currentUserId={user.id} messages={thread} />
      ) : null}
    </div>
  );
}
