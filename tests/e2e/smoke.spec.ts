import { expect, test } from "@playwright/test";

import {
  activityAddress,
  closeDb,
  findBookableActivityId,
  readOtp,
  sql,
} from "./helpers/db";

// Sign-in is rate limited per IP; every test starts from a clean window.
test.beforeEach(async () => {
  await sql`delete from rate_limits`;
});

test.afterAll(async () => {
  await closeDb();
});

test.describe("public site", () => {
  test("landing page renders in English and Bangla", async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://localhost:3000" }]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Find your people",
    );

    await page.getByRole("button", { name: "Language" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
    await expect(page).toHaveURL("http://localhost:3000/");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  });

  test("dark mode persists without changing the URL", async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://localhost:3000" }]);
    await page.goto("/");
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page).toHaveURL("http://localhost:3000/");
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("old locale-prefixed links migrate to cookie-based URLs", async ({ page }) => {
    await page.goto("/bn/guidelines");
    await expect(page).toHaveURL("http://localhost:3000/guidelines");
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  });

  test("guidelines are readable without an account", async ({ page }) => {
    await page.goto("/guidelines");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Community guidelines",
    );

    await page.goto("/credits");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the app is installable (manifest + icons)", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = await manifest.json();
    expect(body.name).toContain("APON");
    expect(body.icons.map((icon: { sizes: string }) => icon.sizes)).toContain("512x512");

    const icon = await request.get("/icons/icon-512.png");
    expect(icon.ok()).toBe(true);
    expect(icon.headers()["content-type"]).toContain("image/png");
  });

  test("signed-out members are sent to sign-in", async ({ page }) => {
    await page.goto("/activities");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

const PASSWORD = "Circle2026safe";

test.describe("password authentication", () => {
  test("sign-up requires email verification, then email or username + password sign-in", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `auth.${stamp}@apon.test`;
    const username = `auth_${stamp}`;

    // ---------------------------------------------------------------- sign up
    await page.goto("/sign-up");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill("short1");
    await page.getByLabel("Confirm password").fill("short1");
    await page.getByRole("button", { name: "Create account" }).click();
    // Client-side validation blocks weak passwords before any request.
    await expect(page.getByText("Password doesn't meet the requirements")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/verify\?email=/);

    // ---------------------------------------- unverified accounts can't sign in
    const unverified = await page.context().browser()!.newPage();
    await unverified.goto("/sign-in");
    await unverified.getByLabel("Email or username").fill(username);
    await unverified.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await unverified.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(unverified).toHaveURL(/\/verify/);
    await unverified.close();

    // ------------------------------------------------------- verify by code
    await expect
      .poll(() => readOtp(`email-verification-otp-${email}`).catch(() => ""), {
        message: "verification code stored",
      })
      .toMatch(/^\d{6}$/);
    const code = await readOtp(`email-verification-otp-${email}`);
    await page.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByText("That code is incorrect or has expired.")).toBeVisible();

    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Verify email" }).click();
    // Verification signs the user in and lands on onboarding.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });

    // ----------------------------------------------------- sign out, sign in
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email or username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill("WrongPass999");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Incorrect email/username or password.")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });

    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email or username").fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });

    // Signed-in users are kept away from the auth pages.
    await page.goto("/sign-up");
    await expect(page).not.toHaveURL(/sign-up/);
  });

  test("forgot password resets with an emailed code and signs out old sessions", async ({
    page,
    browser,
  }) => {
    const email = "nusrat@apon.app";
    const newPassword = `Reset${Date.now()}x`;
    await sql`update accounts set password = (select password from accounts where user_id = 'seed_admin_01')
              where user_id = 'seed_host_01' and provider_id = 'credential'`;

    // An existing session on another device…
    const other = await browser.newContext({ baseURL: "http://localhost:3000" });
    const signedIn = await other.request.post("/api/auth/sign-in/username", {
      data: { username: "nusrat.jahan", password: "Apon2026demo" },
      headers: { origin: "http://localhost:3000" },
    });
    expect(signedIn.ok()).toBe(true);
    expect(
      await (await other.request.get("/api/auth/get-session")).json(),
    ).not.toBeNull();

    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a reset code" }).click();
    await expect(page).toHaveURL(/\/reset-password\?email=/);

    await expect
      .poll(() => readOtp(`forget-password-otp-${email}`).catch(() => ""), {
        message: "reset code stored",
      })
      .toMatch(/^\d{6}$/);
    const code = await readOtp(`forget-password-otp-${email}`);

    await page.getByLabel("Reset code").fill(code);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(
      page.getByText("Your password has been updated. Sign in with your new password."),
    ).toBeVisible();

    // …is revoked by the reset, and the old password no longer works.
    expect(await (await other.request.get("/api/auth/get-session")).json()).toBeNull();
    const oldPassword = await other.request.post("/api/auth/sign-in/username", {
      data: { username: "nusrat.jahan", password: "Apon2026demo" },
      headers: { origin: "http://localhost:3000" },
    });
    expect(oldPassword.status()).toBe(401);
    await other.close();

    await page.getByLabel("Email or username").fill("nusrat.jahan");
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 30_000 });

    // Restore the seeded password so the suite stays repeatable.
    await sql`update accounts set password = (select password from accounts where user_id = 'seed_admin_01')
              where user_id = 'seed_host_01' and provider_id = 'credential'`;
  });

  test("signed-in users can change their password in Settings", async ({ page }) => {
    const newPassword = `Changed${Date.now()}x`;
    // Start from the seeded password even if an earlier run stopped half-way.
    await sql`update accounts set password = (select password from accounts where user_id = 'seed_admin_01')
              where user_id = 'seed_host_03' and provider_id = 'credential'`;
    await page.goto("/sign-in");
    await page.getByLabel("Email or username").fill("sadia@apon.app");
    await page.getByLabel("Password", { exact: true }).fill("Apon2026demo");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 30_000 });

    await page.goto("/settings#security");
    await page.getByLabel("Current password").fill("NotMyPassword1");
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Your current password is incorrect.")).toBeVisible();

    await page.getByLabel("Current password").fill("Apon2026demo");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Password updated.")).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email or username").fill("sadia.rahman");
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 30_000 });

    await sql`update accounts set password = (select password from accounts where user_id = 'seed_admin_01')
              where user_id = 'seed_host_03' and provider_id = 'credential'`;
  });

  test("the old passwordless code sign-in is gone", async ({ request }) => {
    const disabled = await request.post("/api/auth/sign-in/email-otp", {
      data: { email: "admin@apon.app", otp: "123456" },
      headers: { origin: "http://localhost:3000" },
    });
    expect(disabled.status()).toBe(404);
  });
});

test.describe("member journey", () => {
  test("sign up → onboard → verify phone → RSVP reveals the venue", async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e.${stamp}@apon.test`;
    // Valid Bangladeshi mobile format, unique per run.
    const phone = `018${String(stamp).slice(-8)}`;

    // --------------------------------------------------- sign up + verify
    await page.goto("/sign-up");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Username").fill(`member_${stamp}`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/verify/);

    await expect
      .poll(() => readOtp(`email-verification-otp-${email}`).catch(() => ""), {
        message: "verification code stored",
      })
      .toMatch(/^\d{6}$/);
    await page
      .getByLabel("6-digit code")
      .fill(await readOtp(`email-verification-otp-${email}`));
    await page.getByRole("button", { name: "Verify email" }).click();

    // ------------------------------------------------------------- onboarding
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Set up your profile",
    );

    // Step 1 — interests (3–8).
    const chips = page.locator("main button[aria-pressed]");
    for (let index = 0; index < 3; index += 1) {
      const chip = chips.nth(index);
      // Retry until the click lands after hydration (a cold dev compile can be slow).
      await expect(async () => {
        if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
        await expect(chip).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 2 — location: search the nationwide tree, then narrow with the cascade.
    await page.getByRole("heading", { name: /Where do you live/ }).waitFor();
    await page.getByPlaceholder(/Search any place/).fill("Gulshan 2");
    await page
      .getByRole("option", { name: /Gulshan 2/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Gulshan 2" })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 3 — availability.
    await page.getByRole("heading", { name: /When are you usually free/ }).waitFor();
    await page.locator("main button[aria-pressed]").first().click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 4 — preferences + guidelines.
    await page.getByRole("heading", { name: /How should your circle look/ }).waitFor();
    await page.getByRole("checkbox", { name: /I have read and accept/ }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page.getByText("All set").first()).toBeVisible({ timeout: 30_000 });

    // --------------------------------------------------- phone verification
    await page.goto("/settings");
    await page.getByLabel("Phone number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();

    await expect
      .poll(() => readOtp(phone.replace(/^0/, "")).catch(() => ""), {
        message: "SMS OTP should be stored",
      })
      .toMatch(/^\d{6}$/);
    const smsCode = await readOtp(phone.replace(/^0/, ""));

    await page.getByLabel("6-digit code").fill(smsCode);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("Phone verified")).toBeVisible({ timeout: 30_000 });

    // ------------------------------------------------------------------ RSVP
    const activityId = await findBookableActivityId();
    const address = await activityAddress(activityId);

    await page.goto(`/activities/${activityId}`);

    // The exact venue stays hidden until the RSVP is confirmed.
    await expect(page.getByText("Address visible after you RSVP")).toBeVisible();

    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByText("You are in")).toBeVisible({ timeout: 30_000 });

    if (address) {
      await expect(page.getByText(address)).toBeVisible();
      await expect(page.getByText("Address visible after you RSVP")).toBeHidden();
    }

    // ------------------------------------------------ role-based access
    // Members get a 403 for the Admin Panel and host tools, not a silent redirect.
    const adminResponse = await page.goto("/admin");
    expect(adminResponse?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: /don't have access/ })).toBeVisible();

    const hostResponse = await page.goto("/host/new");
    expect(hostResponse?.status()).toBe(403);
  });
});
