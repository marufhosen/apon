import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { type Permission, type Role, can, toRole } from "@/lib/rbac";

/** Current Better Auth session (or null). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Full row from `users`, including status/role/profile columns.
 * Memoised per request, so layered guards (layout + page) cost one query.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return rows[0] ?? null;
});

export type GuardedUser = User;

function nextPath(pathname?: string) {
  return pathname ? `?next=${encodeURIComponent(pathname)}` : "";
}

/**
 * Server Action / page guard: must be signed in, not suspended.
 * Suspended users are signed out and parked on the sign-in screen.
 */
export async function requireUser(nextPathname?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/sign-in${nextPath(nextPathname)}`);
  }
  if (user.status === "suspended") {
    await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
    redirect("/sign-in?error=suspended");
  }
  return user;
}

/**
 * Role guard for layouts and pages. Signed-out users are sent to sign-in;
 * signed-in users without the role get the 403 page (`forbidden.tsx`).
 */
export async function requireRole(roles: readonly Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(toRole(user.role))) forbidden();
  return user;
}

/** Permission guard, e.g. `requirePermission("admin.locations")`. */
export async function requirePermission(permission: Permission): Promise<User> {
  const user = await requireUser();
  if (!can(user.role, permission)) forbidden();
  return user;
}

/** Admin-only guard used by the Admin Panel layout and every admin page. */
export async function requireAdmin(): Promise<User> {
  return requireRole(["admin"]);
}

/** Host tools (create/manage activities). */
export async function requireHost(): Promise<User> {
  return requireRole(["host", "admin"]);
}

/** Phone verification is required before joining circles or activities. */
export async function requireVerifiedPhone(): Promise<User> {
  const user = await requireUser();
  if (!user.phoneNumberVerified) {
    redirect("/onboarding?step=phone");
  }
  return user;
}

/** Onboarding completion check used by the (app) pages. */
export async function requireOnboarded(): Promise<User> {
  const user = await requireUser();
  if (!user.onboardedAt) {
    redirect("/onboarding");
  }
  return user;
}
