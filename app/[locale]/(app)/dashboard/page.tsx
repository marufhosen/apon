import { redirect } from "next/navigation";

import { requireUser } from "@/lib/session";
import { homePathFor, toRole } from "@/lib/rbac";

/** Role-aware landing page (the proxy normally redirects before this renders). */
export default async function DashboardPage() {
  const user = await requireUser();
  redirect(homePathFor(toRole(user.role)));
}
