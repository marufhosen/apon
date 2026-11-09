import { describe, expect, it } from "vitest";

import {
  can,
  decideAccess,
  homePathFor,
  ruleFor,
  toRole,
  type AccessSubject,
} from "@/lib/rbac";

const member: AccessSubject = { role: "member", onboarded: true };
const newMember: AccessSubject = { role: "member", onboarded: false };
const host: AccessSubject = { role: "host", onboarded: true };
const admin: AccessSubject = { role: "admin", onboarded: false };

const seg = (path: string) => path.split("/").filter(Boolean);

describe("ruleFor", () => {
  it("classifies every section", () => {
    expect(ruleFor([]).section).toBe("public");
    expect(ruleFor(seg("guidelines")).section).toBe("public");
    expect(ruleFor(seg("sign-in")).section).toBe("auth");
    expect(ruleFor(seg("sign-up")).section).toBe("auth");
    expect(ruleFor(seg("forgot-password")).section).toBe("auth");
    expect(ruleFor(seg("reset-password")).section).toBe("auth");
    expect(ruleFor(seg("home")).section).toBe("member");
    expect(ruleFor(seg("host")).section).toBe("member");
    expect(ruleFor(seg("host/new")).section).toBe("host");
    expect(ruleFor(seg("host/12/edit")).section).toBe("host");
    expect(ruleFor(seg("admin/users")).section).toBe("admin");
  });
});

describe("decideAccess", () => {
  it("lets anyone see public pages", () => {
    expect(decideAccess([], null)).toEqual({ kind: "allow" });
    expect(decideAccess(seg("credits"), member)).toEqual({ kind: "allow" });
  });

  it("sends signed-out visitors to sign-in with a return path", () => {
    expect(decideAccess(seg("circles/3"), null, "/circles/3")).toEqual({
      kind: "redirect",
      to: "/sign-in?next=%2Fcircles%2F3",
    });
    expect(decideAccess(seg("admin"), null)).toEqual({
      kind: "redirect",
      to: "/sign-in",
    });
  });

  it("keeps signed-in users out of the auth pages", () => {
    expect(decideAccess(seg("sign-in"), member)).toEqual({
      kind: "redirect",
      to: "/home",
    });
    expect(decideAccess(seg("verify"), admin)).toEqual({
      kind: "redirect",
      to: "/admin",
    });
    expect(decideAccess(seg("sign-up"), member)).toEqual({
      kind: "redirect",
      to: "/home",
    });
    expect(decideAccess(seg("sign-up"), null)).toEqual({ kind: "allow" });
  });

  it("routes /dashboard to each role's panel", () => {
    expect(decideAccess(seg("dashboard"), member)).toEqual({
      kind: "redirect",
      to: "/home",
    });
    expect(decideAccess(seg("dashboard"), host)).toEqual({
      kind: "redirect",
      to: "/home",
    });
    expect(decideAccess(seg("dashboard"), admin)).toEqual({
      kind: "redirect",
      to: "/admin",
    });
  });

  it("forbids the admin panel to members and hosts", () => {
    expect(decideAccess(seg("admin"), member)).toEqual({ kind: "forbidden" });
    expect(decideAccess(seg("admin/reports"), host)).toEqual({ kind: "forbidden" });
    expect(decideAccess(seg("admin/reports"), admin)).toEqual({ kind: "allow" });
  });

  it("restricts host tools to hosts and admins", () => {
    expect(decideAccess(seg("host"), member)).toEqual({ kind: "allow" });
    expect(decideAccess(seg("host/new"), member)).toEqual({ kind: "forbidden" });
    expect(decideAccess(seg("host/new"), host)).toEqual({ kind: "allow" });
    expect(decideAccess(seg("host/7/edit"), admin)).toEqual({ kind: "allow" });
  });

  it("requires onboarding for member pages, except setup pages and admins", () => {
    expect(decideAccess(seg("home"), newMember)).toEqual({
      kind: "redirect",
      to: "/onboarding",
    });
    expect(decideAccess(seg("onboarding"), newMember)).toEqual({ kind: "allow" });
    expect(decideAccess(seg("settings"), newMember)).toEqual({ kind: "allow" });
    expect(decideAccess(seg("home"), admin)).toEqual({ kind: "allow" });
  });
});

describe("permissions", () => {
  it("grants by role", () => {
    expect(can("member", "activities.host")).toBe(false);
    expect(can("host", "activities.host")).toBe(true);
    expect(can("host", "admin.access")).toBe(false);
    expect(can("admin", "admin.locations")).toBe(true);
  });

  it("treats unknown roles as members", () => {
    expect(toRole("superuser")).toBe("member");
    expect(can("superuser", "admin.access")).toBe(false);
  });

  it("lands admins in the admin panel", () => {
    expect(homePathFor("admin")).toBe("/admin");
    expect(homePathFor("member")).toBe("/home");
  });
});
