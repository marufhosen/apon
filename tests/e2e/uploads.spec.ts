import { expect, test, type Page } from "@playwright/test";

import { closeDb, sql } from "./helpers/db";
import {
  MOCK,
  startMockCloudinary,
  type MockCloudinary,
} from "./helpers/mock-cloudinary";

/**
 * Cloudinary uploads end to end. The dev server must run with
 *   CLOUDINARY_CLOUD_NAME=apon-test CLOUDINARY_API_KEY=test-key
 *   CLOUDINARY_API_SECRET=test-secret-0123456789 CLOUDINARY_API_BASE=http://127.0.0.1:4599
 * so it talks to the signature-verifying stand-in started below.
 */

const PASSWORD = "Apon2026demo";
// 1×1 PNG and a tiny valid PDF.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
);

let cloud: MockCloudinary;

test.beforeAll(async () => {
  cloud = await startMockCloudinary();
  // Re-runnable: clear what earlier runs of this file created.
  await sql`delete from rate_limits`;
  await sql`delete from reports where reporter_id in ('seed_user_40', 'seed_user_04')`;
  await sql`update users set avatar_url = null where id = 'seed_user_03'`;
});
// Sign-in is rate limited per IP; every test starts from a clean window.
test.beforeEach(async () => {
  await sql`delete from rate_limits`;
});

test.afterAll(async () => {
  await cloud.close();
  await closeDb();
});

async function signIn(page: Page, identifier: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 });
}

test("avatar: validated, signed upload; save; replace deletes the old asset", async ({
  page,
}) => {
  await signIn(page, "sumaiya.rahman");
  await page.goto("/settings#profile");
  const fileInput = page.locator("#profile input[type=file]");

  // An SVG renamed to .png is rejected by content sniffing before upload.
  const before = cloud.uploads.length;
  await fileInput.setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: SVG,
  });
  await expect(
    page.getByText("That file type isn't allowed. Use JPG, PNG, WEBP."),
  ).toBeVisible();
  expect(cloud.uploads.length).toBe(before);

  // A real PNG goes to Cloudinary with a valid signature and safe parameters.
  await fileInput.setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  const preview = page.locator('#profile img[src*="res.cloudinary.com"]');
  await expect(preview).toHaveAttribute(
    "src",
    new RegExp(`res\\.cloudinary\\.com/${MOCK.cloudName}/image/upload/`),
  );
  const first = cloud.uploads.at(-1)!;
  expect(first.params.folder).toBe("apon/avatars");
  expect(first.params.type).toBe("upload");
  expect(first.params.transformation).toBe("c_limit,w_800,h_800");
  expect(first.params.context).toContain("purpose=avatar");
  expect(cloud.rejected).toEqual([]);

  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
  const [saved] = await sql<
    { avatar_url: string }[]
  >`select avatar_url from users where username = 'sumaiya.rahman'`;
  expect(saved.avatar_url).toContain(first.publicId);

  // Replacing it removes the previous asset from Cloudinary.
  await fileInput.setInputFiles({ name: "me2.png", mimeType: "image/png", buffer: PNG });
  await expect(preview).toHaveAttribute(
    "src",
    new RegExp(cloud.uploads.at(-1)!.publicId),
  );
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect.poll(() => cloud.destroyed).toContain(first.publicId);
});

test("report evidence is private; admins open it via a signed, expiring link", async ({
  page,
}) => {
  await signIn(page, "fahim.uddin");
  await page.goto("/profile/seed_user_02");
  await page
    .getByRole("button", { name: /Send report|Report/ })
    .first()
    .click();
  await page
    .locator("[role=dialog] input[type=file]")
    .setInputFiles({
      name: "Evidence (chat).pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
  await expect(page.getByText("Evidence-chat.pdf")).toBeVisible();
  const evidence = cloud.uploads.at(-1)!;
  expect(evidence.resourceType).toBe("raw");
  expect(evidence.params.type).toBe("authenticated");
  expect(evidence.params.folder).toBe("apon/reports");
  await page.getByRole("button", { name: "Send report" }).last().click();
  await expect(page.getByText("Thanks — our team will review this.")).toBeVisible();

  await signIn(page, "admin@apon.app");
  await page.goto("/admin/reports");
  const link = page.getByRole("link", { name: "View attachment" }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  expect(href).toContain(`/v1_1/${MOCK.cloudName}/raw/download?`);
  expect(href).toContain("expires_at=");
  expect(href).not.toContain(MOCK.apiSecret);

  // The stand-in verifies the signature like Cloudinary would.
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(Buffer.from(await res.body()).toString()).toContain("%PDF-1.4");
  const tampered = await page.request.get(
    href.replace(/signature=[0-9a-f]+/, "signature=deadbeef"),
  );
  expect(tampered.status()).toBe(401);
});

test("forms only accept the caller's own uploads", async ({ page }) => {
  // Someone else's private upload id…
  const [foreign] = await sql<{ id: number }[]>`
    select id from uploads where owner_id <> 'seed_user_04' and purpose = 'report_evidence' order by id desc limit 1`;
  expect(foreign).toBeTruthy();

  await signIn(page, "imran.hossain");
  await page.goto("/profile/seed_user_05");
  await page
    .getByRole("button", { name: /Send report|Report/ })
    .first()
    .click();
  // …smuggled into the hidden field is refused server-side.
  await page
    .locator('[role=dialog] input[name="attachmentUploadId"]')
    .evaluate((el, id) => {
      (el as HTMLInputElement).value = String(id);
    }, foreign.id);
  await page.getByRole("button", { name: "Send report" }).last().click();
  await expect(
    page.getByText("That file can't be used here — please upload it again."),
  ).toBeVisible();
});

test("hosts upload an activity cover and submit the activity", async ({ page }) => {
  await signIn(page, "nusrat.jahan");
  await page.goto("/host/new");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator('img[src*="apon/activities/"]')).toBeVisible();
  const cover = cloud.uploads.at(-1)!;
  expect(cover.params.transformation).toBe("c_limit,w_2000,h_2000");

  const title = `Cover test ${Date.now()}`;
  const date = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("Description")
    .fill("A relaxed evening walk with tea afterwards. Everyone welcome.");
  await page.locator("#category").selectOption({ index: 1 });
  await page.locator("#venue").selectOption({ index: 1 });
  await page.locator("#date").fill(date);
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Activity submitted for approval.")).toBeVisible({
    timeout: 30_000,
  });

  const [row] = await sql<
    { image_url: string }[]
  >`select image_url from activities where title = ${title}`;
  expect(row.image_url).toContain(cover.publicId);
});

test("members can't upload for host-only or admin-only purposes", async ({ page }) => {
  await signIn(page, "rafi.ahmed2");
  // A member has no host page, so no cover uploader is ever rendered…
  const res = await page.goto("/host/new");
  expect(res?.status()).toBe(403);
  // …and the upload policy itself requires the host/admin role (unit-tested in tests/unit/uploads.test.ts).
});
