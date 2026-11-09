import { getAttachmentLinks } from "@/lib/uploads/server";
import { AttachmentLink } from "@/components/features/uploads/attachment-link";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/session";
import { getReportTarget, listReports } from "@/lib/queries/admin";
import { ReportActions } from "@/components/features/admin/report-actions";
import { HideMessageButton } from "@/components/features/admin/hide-message-button";
import { EmptyState } from "@/components/features/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STATUSES = ["open", "actioned", "dismissed"] as const;

export async function generateMetadata() {
  const t = await getTranslations("admin.reports");
  return { title: t("title") };
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const active = STATUSES.find((s) => s === status) ?? "open";

  const [t, rows] = await Promise.all([getTranslations("admin.reports"), listReports(active)]);
  const [attachments, targets] = await Promise.all([
    getAttachmentLinks(rows.map((r) => r.report.attachmentUploadId)),
    Promise.all(rows.map((r) => getReportTarget(r.report))),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>

      <nav aria-label={t("statusFilter")} className="flex flex-wrap gap-2">
        {STATUSES.map((option) => (
          <Link
            key={option}
            href={`/admin/reports?status=${option}`}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-sm transition-colors",
              option === active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {t(option)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="space-y-3">
          {rows.map(({ report, reporterName }, index) => {
            const target = targets[index];
            return (
            <Card key={report.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={report.status === "open" ? "warning" : "outline"}>
                    {t(report.status)}
                  </Badge>
                  <Badge variant="outline">
                    {t("target")}: {report.targetType} #{report.targetId}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("reporter")}: {reporterName ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {report.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </div>

                <p className="text-sm">
                  <span className="font-medium">{report.reason}</span>
                  {report.details ? ` — ${report.details}` : ""}
                </p>

                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("targetPreview")}
                  </p>
                  {target.kind === "message" ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm">“{target.body}”</p>
                      <p className="text-xs text-muted-foreground">
                        {t("messageBy", { name: target.authorName, circle: target.circleName })}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {target.hiddenAt ? (
                          <Badge variant="secondary">{t("alreadyHidden")}</Badge>
                        ) : (
                          <HideMessageButton messageId={target.id} />
                        )}
                        <Link
                          href={`/circles/${target.circleId}`}
                          className="text-xs text-primary underline-offset-4 hover:underline"
                        >
                          {t("openCircle")}
                        </Link>
                      </div>
                    </div>
                  ) : target.kind === "activity" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/activities/${target.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {target.title}
                      </Link>
                      <Badge variant="outline">{target.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {t("hostedBy", { name: target.hostName })}
                      </span>
                    </div>
                  ) : target.kind === "user" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/profile/${target.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {target.name}
                      </Link>
                      {target.username ? (
                        <span className="text-xs text-muted-foreground">@{target.username}</span>
                      ) : null}
                      <Badge variant="outline">{target.status}</Badge>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{t("missingTarget")}</p>
                  )}
                </div>

                {report.attachmentUploadId ? (
                  <AttachmentLink attachment={attachments.get(report.attachmentUploadId)} />
                ) : null}

                {report.status === "open" ? <ReportActions reportId={report.id} /> : null}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
