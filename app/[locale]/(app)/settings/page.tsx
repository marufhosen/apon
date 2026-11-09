import { ShieldCheck } from "lucide-react";
import { SecurityCard } from "@/components/features/profile/security-card";
import { hasCredentialPassword } from "@/lib/queries/users";
import { getTranslations } from "next-intl/server";
import { Bell, Eye, Languages, TriangleAlert, UserCog } from "lucide-react";

import { requireOnboarded } from "@/lib/session";
import { getLocationTrail } from "@/lib/queries/locations";
import { getBlockedUsers, getNotificationPrefs } from "@/lib/queries/users";
import { PageHeader } from "@/components/features/shared/page-header";
import { ProfileEditForm } from "@/components/features/profile/profile-edit-form";
import { PrivacyForm } from "@/components/features/profile/privacy-form";
import { NotificationPrefsForm } from "@/components/features/profile/notification-prefs-form";
import { LanguageForm } from "@/components/features/profile/language-form";
import { BlockedList } from "@/components/features/profile/blocked-list";
import { PhoneVerifyCard } from "@/components/features/profile/phone-verify-card";
import { DeleteAccountDialog } from "@/components/features/profile/delete-account-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeUp } from "@/components/motion";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const user = await requireOnboarded();

  const [t, tp, ts, areaTrail, prefs, blocked, hasPassword] = await Promise.all([
    getTranslations("settings"),
    getTranslations("profile"),
    getTranslations("auth.security"),
    getLocationTrail(user.areaId),
    getNotificationPrefs(user.id),
    getBlockedUsers(user.id),
    hasCredentialPassword(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t("title")} subtitle={t("notificationsHint")} />

      <FadeUp>
        <div id="phone">
          <PhoneVerifyCard
            verified={user.phoneNumberVerified}
            defaultPhone={user.phoneNumber}
          />
        </div>
      </FadeUp>

      <FadeUp>
        <Card id="profile">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCog className="text-primary size-4" aria-hidden />
              {tp("editTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileEditForm
              areaTrail={areaTrail}
              initial={{
                name: user.name,
                gender: user.gender ?? "",
                birthYear: user.birthYear ? String(user.birthYear) : "",
                areaId: user.areaId ? String(user.areaId) : "",
                bio: user.bio ?? "",
                avatarUrl: user.avatarUrl ?? "",
              }}
            />
          </CardContent>
        </Card>
      </FadeUp>

      <FadeUp>
        <Card id="privacy">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="text-primary size-4" aria-hidden />
              {t("privacy")}
            </CardTitle>
            <p className="text-muted-foreground text-xs">{t("privacyHint")}</p>
          </CardHeader>
          <CardContent>
            <PrivacyForm
              initial={{
                profileVisibility: user.profileVisibility as
                  "members" | "circles" | "hidden",
                showGender: user.showGender,
                showAge: user.showAge,
                areaVisibility: user.areaVisibility as "exact" | "zone" | "hidden",
              }}
            />
          </CardContent>
        </Card>
      </FadeUp>

      <FadeUp>
        <Card id="language">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Languages className="text-primary size-4" aria-hidden />
              {t("language")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LanguageForm />
          </CardContent>
        </Card>
      </FadeUp>

      <FadeUp>
        <Card id="security">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="text-primary size-4" aria-hidden />
              {ts("title")}
            </CardTitle>
            <p className="text-muted-foreground text-xs">{ts("subtitle")}</p>
          </CardHeader>
          <CardContent>
            <SecurityCard
              hasPassword={hasPassword}
              username={user.displayUsername ?? user.username}
              email={user.email}
            />
          </CardContent>
        </Card>
      </FadeUp>

      <FadeUp>
        <Card id="notifications">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="text-primary size-4" aria-hidden />
              {t("notifications")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NotificationPrefsForm
              initial={{
                emailCircleInvites: prefs.emailCircleInvites,
                emailActivityReminders: prefs.emailActivityReminders,
                emailFeedbackRequests: prefs.emailFeedbackRequests,
                emailGeneral: prefs.emailGeneral,
                inAppNotifications: prefs.inAppNotifications,
              }}
            />
          </CardContent>
        </Card>
      </FadeUp>

      <FadeUp>
        <Card id="blocked">
          <CardHeader>
            <CardTitle className="text-base">{t("blockedTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BlockedList
              users={blocked.map((b) => ({
                id: b.id,
                name: b.name,
                avatarUrl: b.avatarUrl,
              }))}
            />
          </CardContent>
        </Card>
      </FadeUp>

      <FadeUp>
        <Card id="danger" className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" aria-hidden />
              {t("deleteTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">{t("deleteText")}</p>
            <DeleteAccountDialog />
          </CardContent>
        </Card>
      </FadeUp>
    </div>
  );
}
