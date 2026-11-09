import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * End-to-end smoke test.
 *
 * Runs against a real dev server and the local Postgres (the OTP codes are read
 * from the `verifications` table), so it exercises the actual sign-in →
 * onboarding → RSVP path. Set `E2E_BASE_URL` to reuse an already-running
 * server; otherwise Playwright starts `npm run dev` for the run.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: "pipe",
      },
});
