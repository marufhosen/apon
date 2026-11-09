import { expect, test, type Page } from "@playwright/test";

import { closeDb, sql } from "./helpers/db";

// Sign-in is rate limited per IP; every test starts from a clean window.
test.beforeEach(async () => {
  await sql`delete from rate_limits`;
});

test.afterAll(async () => {
  await closeDb();
});

async function signIn(page: Page, identifier: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill("Apon2026demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 });
}

test.beforeAll(async () => {
  await sql`delete from rate_limits`;
});

test("admins open circle details from the circles list", async ({ page }) => {
  await signIn(page, "admin@apon.app");
  await page.goto("/admin/circles");
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/admin\/circles\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await expect(page.getByRole("columnheader", { name: "Member" })).toBeVisible();
  await expect(page.getByText("Message contents are private to members.")).toBeVisible();
});

test("circle details are admin-only and the member page stays private", async ({
  page,
}) => {
  const [circle] = await sql<
    { id: number }[]
  >`select id from circles order by id limit 1`;
  await signIn(page, "rafi.ahmed2");
  expect((await page.goto(`/admin/circles/${circle.id}`))?.status()).toBe(403);
});

test("venue modal fits short screens and scrolls to Save", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await signIn(page, "admin@apon.app");
  await page.goto("/admin/venues");
  await page.getByRole("button", { name: "Add venue" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport();
});
