import { expect, test, type Page } from "@playwright/test";

import { closeDb, sql } from "./helpers/db";

// Sign-in is rate limited per IP; every test starts from a clean window.
test.beforeEach(async () => {
  await sql`delete from rate_limits`;
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeAll(async () => {
  await sql`delete from rate_limits`;
});

async function signIn(page: Page, identifier: string, locale = "en") {
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://localhost:3000" }]);
  await page.goto("/sign-in");
  await page.locator("#identifier").fill(identifier);
  await page.locator("#password").fill("Apon2026demo");
  await page.locator("form button[type=submit]").click();
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 });
}

async function womenOnlyActivity() {
  const [row] = await sql<{ id: number }[]>`
    select id from activities where women_only and status = 'approved' and starts_at > now() order by id limit 1`;
  return row.id;
}

test("errors are real sentences, never translation keys (en + bn)", async ({ page }) => {
  const id = await womenOnlyActivity();
  // A male, phone-verified seeded member.
  await signIn(page, "rafi.ahmed2");

  await page.goto(`/activities/${id}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText("This activity is for women only.")).toBeVisible();
  await expect(page.getByText("activities.detail.womenOnlyNote")).toHaveCount(0);

  await page
    .context()
    .addCookies([{ name: "NEXT_LOCALE", value: "bn", url: "http://localhost:3000" }]);
  await page.goto(`/activities/${id}`);
  await page.getByRole("button", { name: "যোগ দিন", exact: true }).click();
  await expect(page.getByText("এই আয়োজনটি শুধু নারীদের জন্য।")).toBeVisible();
});

test("activity page has one clearly labelled report button per target", async ({
  page,
}) => {
  const id = await womenOnlyActivity();
  await signIn(page, "rafi.ahmed2");
  await page.goto(`/activities/${id}`);
  await expect(page.getByRole("button", { name: "Report activity" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Report host" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send report" })).toHaveCount(0);
});
