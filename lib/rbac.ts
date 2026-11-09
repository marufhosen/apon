/**
 * Role-based access control — the single source of truth for who may open
 * which section of the app. Pure (no I/O, no server-only imports) so the
 * proxy, layouts, navigation and unit tests all share one policy.
 *
 *   public  — landing, guidelines, credits            (anyone)
 *   auth    — sign-in, sign-up, verify, password reset (signed-out only)
 *   member  — the User Panel: home, circles, …        (any signed-in role)
 *   host    — create/manage activities                (host, admin)
 *   admin   — the Admin Panel                         (admin)
 *
 * Enforcement is layered: `proxy.ts` decides first (cheap redirect / 403),
 * then each route-group layout re-checks with `requireRole`, and every
 * Server Action re-checks through `createAction({ authorize })`.
 */

export const ROLES = ["member", "host", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function toRole(value: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(value ?? "") ? (value as Role) : "member";
}

export type Section = "public" | "auth" | "member" | "host" | "admin";

export interface RouteRule {
  section: Section;
  /** Roles allowed in. Empty for public/auth sections. */
  roles: readonly Role[];
  /** Must the member have finished onboarding? (Admins are exempt.) */
  onboarding: boolean;
}

const ANY_SIGNED_IN: readonly Role[] = ROLES;
const HOSTS: readonly Role[] = ["host", "admin"];
const ADMINS: readonly Role[] = ["admin"];

const PUBLIC: RouteRule = { section: "public", roles: [], onboarding: false };
const AUTH: RouteRule = { section: "auth", roles: [], onboarding: false };

/** Classify the visible, locale-neutral path (`/admin/users` → `["admin","users"]`). */
export function ruleFor(segments: string[]): RouteRule {
  const [head = "", second] = segments;
  switch (head) {
    case "sign-in":
    case "sign-up":
    case "verify":
    case "forgot-password":
    case "reset-password":
      return AUTH;
    case "admin":
      return { section: "admin", roles: ADMINS, onboarding: false };
    case "host":
      // `/host` itself doubles as the "apply to host" page for members.
      return second
        ? { section: "host", roles: HOSTS, onboarding: true }
        : { section: "member", roles: ANY_SIGNED_IN, onboarding: true };
    case "dashboard":
      return { section: "member", roles: ANY_SIGNED_IN, onboarding: false };
    case "onboarding":
    case "settings":
    case "profile":
      return { section: "member", roles: ANY_SIGNED_IN, onboarding: false };
    case "home":
    case "circles":
    case "activities":
    case "notifications":
      return { section: "member", roles: ANY_SIGNED_IN, onboarding: true };
    default:
      return PUBLIC;
  }
}

/** Where a role lands after signing in. */
export function homePathFor(role: Role): "/admin" | "/home" {
  return role === "admin" ? "/admin" : "/home";
}

export interface AccessSubject {
  role: Role;
  onboarded: boolean;
}

export type AccessDecision =
  { kind: "allow" } | { kind: "redirect"; to: string } | { kind: "forbidden" };

/**
 * Decide what happens to a request. `to` paths are locale-neutral and can be
 * returned directly because next-intl resolves the cookie internally.
 */
export function decideAccess(
  segments: string[],
  user: AccessSubject | null,
  requestedPath = "",
): AccessDecision {
  const rule = ruleFor(segments);

  if (rule.section === "public") return { kind: "allow" };

  if (rule.section === "auth") {
    return user ? { kind: "redirect", to: homePathFor(user.role) } : { kind: "allow" };
  }

  if (!user) {
    const next = requestedPath ? `?next=${encodeURIComponent(requestedPath)}` : "";
    return { kind: "redirect", to: `/sign-in${next}` };
  }

  // `/dashboard` is a role-aware landing page (used after sign-in).
  if (segments[0] === "dashboard")
    return { kind: "redirect", to: homePathFor(user.role) };

  if (!rule.roles.includes(user.role)) return { kind: "forbidden" };

  if (rule.onboarding && !user.onboarded && user.role !== "admin") {
    return { kind: "redirect", to: "/onboarding" };
  }

  return { kind: "allow" };
}

// ---------------------------------------------------------------------------
// Fine-grained permissions (navigation + action checks)
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  "activities.host",
  "admin.access",
  "admin.users",
  "admin.reports",
  "admin.hosts",
  "admin.activities",
  "admin.venues",
  "admin.locations",
  "admin.circles",
  "admin.metrics",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  member: new Set(),
  host: new Set(["activities.host"]),
  admin: new Set(PERMISSIONS),
};

export function can(role: Role | string, permission: Permission): boolean {
  return GRANTS[toRole(role)].has(permission);
}
