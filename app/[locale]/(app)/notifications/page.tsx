import { getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireOnboarded } from "@/lib/session";
import { listNotifications } from "@/lib/queries/notifications";
import { PageHeader } from "@/components/features/shared/page-header";
import { EmptyState } from "@/components/features/shared/empty-state";
import { MarkAllReadButton } from "@/components/features/notifications/mark-all-read-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

export default async function NotificationsPage() {
  const user = await requireOnboarded();
  const [t, items] = await Promise.all([
    getTranslations("notifications"),
    listNotifications(user.id, 50),
  ]);

  const unread = items.filter((item) => !item.readAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        subtitle={unread > 0 ? t("unread", { count: unread }) : undefined}
        actions={<MarkAllReadButton disabled={unread === 0} />}
      />

      {items.length === 0 ? (
        <EmptyState icon={Bell} title={t("empty")} text={t("emptyText")} />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const payload = item.payload as { messageKey?: unknown };
            const messageKey =
              typeof payload.messageKey === "string"
                ? `messages.${payload.messageKey}`
                : null;
            const body = messageKey && t.has(messageKey) ? t(messageKey) : item.body;
            const content = (
              <Card
                className={cn(
                  "transition-colors",
                  item.readAt ? "bg-card" : "border-primary/30 bg-primary/5",
                )}
              >
                <CardContent className="flex items-start gap-3 py-4">
                  <span
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      item.readAt ? "bg-muted-foreground/30" : "bg-primary",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{item.title}</p>
                      {!item.readAt ? (
                        <Badge variant="secondary">{t("unread", { count: 1 })}</Badge>
                      ) : null}
                    </div>
                    {body ? (
                      <p className="text-muted-foreground mt-0.5 text-sm">{body}</p>
                    ) : null}
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.has(`types.${item.type}`)
                        ? t(`types.${item.type}`)
                        : t("types.generic")}
                      {" · "}
                      {formatDateTime(item.createdAt, user.locale)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );

            return item.href ? (
              <Link key={item.id} href={item.href} className="block">
                {content}
              </Link>
            ) : (
              <div key={item.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
