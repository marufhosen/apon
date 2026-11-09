import { getTranslations } from "next-intl/server";
import { Users, VenetianMask } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/session";
import { listCircles } from "@/lib/queries/circles";
import { listOpenCircleRequests } from "@/lib/queries/admin";
import { RerunMatchingButton } from "@/components/features/admin/rerun-matching-button";
import { ResolveRequestButton } from "@/components/features/admin/resolve-request-button";
import { EmptyState } from "@/components/features/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export async function generateMetadata() {
  const t = await getTranslations("admin.circles");
  return { title: t("title") };
}

export default async function AdminCirclesPage() {
  await requireAdmin();
  const [t, circles, requests] = await Promise.all([
    getTranslations("admin.circles"),
    listCircles(),
    listOpenCircleRequests(),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
        <RerunMatchingButton />
      </div>

      {circles.length === 0 ? (
        <EmptyState icon={VenetianMask} title={t("empty")} />
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("title")}</TableHead>
                <TableHead>{t("zone")}</TableHead>
                <TableHead>{t("size")}</TableHead>
                <TableHead>{t("created")}</TableHead>
                <TableHead className="text-right">{t("formAction")}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {circles.map(({ circle, memberCount }) => (
                <TableRow key={circle.id}>
                  <TableCell className="font-medium">
                    {circle.name}
                    {circle.womenOnly ? (
                      <Badge variant="outline" className="ml-2">
                        {t("womenOnly")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{circle.zone}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      <Users className="size-4 text-muted-foreground" aria-hidden />
                      {memberCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {circle.createdAt.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/circles/${circle.id}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {t("formAction")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("request")}</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {requests.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <Link
                    href={`/profile/${request.userId}`}
                    className="font-medium hover:underline"
                  >
                    {request.userName}
                  </Link>
                  <span className="text-muted-foreground">
                    {request.reason ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(request.createdAt).toISOString().slice(0, 10)}
                  </span>
                  <ResolveRequestButton requestId={request.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
