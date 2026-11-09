import { getTranslations } from "next-intl/server";
import { CalendarDays, MapPin, Pencil } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireOnboarded } from "@/lib/session";
import { getPublicProfile } from "@/lib/queries/users";
import { ReportButton } from "@/components/features/shared/report-button";
import { BlockButton } from "@/components/features/safety/block-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeUp, Stagger, StaggerItem } from "@/components/motion";
import { EmptyState } from "@/components/features/shared/empty-state";
import { formatFullDate } from "@/lib/dates";

/**
 * Public profile. Only the area *name* is ever shown — never a phone number,
 * email or exact address.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireOnboarded();
  const { id } = await params;

  const [t, profile] = await Promise.all([
    getTranslations("profile"),
    getPublicProfile(id, viewer.id),
  ]);

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title={t("notFound")}
          actionLabel={t("publicTitle")}
          actionHref="/home"
        />
      </div>
    );
  }

  const isOwner = profile.id === viewer.id;
  const age = profile.birthYear ? new Date().getFullYear() - profile.birthYear : null;
  const areaName = profile.area
    ? viewer.locale === "bn"
      ? profile.area.nameBn
      : profile.area.nameEn
    : null;
  const genderLabel =
    profile.gender === "male"
      ? t("genderMale")
      : profile.gender === "female"
        ? t("genderFemale")
        : profile.gender === "other"
          ? t("genderOther")
          : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <FadeUp className="flex flex-wrap items-start gap-5">
        <Avatar className="size-20">
          {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-xl">
            {profile.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
            {profile.role === "host" ? <Badge variant="success">Host</Badge> : null}
            {isOwner ? <Badge variant="outline">{t("owner")}</Badge> : null}
          </div>

          <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-4 text-sm">
            {areaName ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden />
                {areaName}
              </span>
            ) : null}
            {genderLabel ? <span>{genderLabel}</span> : null}
            {age ? <span>{t("age", { age })}</span> : null}
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden />
              {t("joined", { date: formatFullDate(profile.createdAt, viewer.locale) })}
            </span>
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {isOwner ? (
              <Button asChild size="sm">
                <Link href="/settings">
                  <Pencil aria-hidden />
                  {t("edit")}
                </Link>
              </Button>
            ) : (
              <>
                <BlockButton
                  userId={profile.id}
                  name={profile.name}
                  isBlocked={profile.isBlocked}
                />
                <ReportButton targetType="user" targetId={profile.id} variant="outline" />
              </>
            )}
          </div>
        </div>
      </FadeUp>

      {profile.restricted ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("restricted")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("about")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {profile.bio || t("noBio")}
              </p>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-base font-semibold">{t("interests")}</h2>
            {profile.interests.length ? (
              <Stagger className="flex flex-wrap gap-2">
                {profile.interests.map((interest) => (
                  <StaggerItem key={interest.id}>
                    <Badge variant="outline" className="px-3 py-1.5 text-sm">
                      {viewer.locale === "bn" ? interest.nameBn : interest.nameEn}
                    </Badge>
                  </StaggerItem>
                ))}
              </Stagger>
            ) : (
              <p className="text-muted-foreground text-sm">{t("noBio")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
