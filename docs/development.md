# Development guide

## Prerequisites

- Node.js 20.9+ (Next.js 16 requirement) and npm.
- PostgreSQL 14+ reachable through `DATABASE_URL`.
- Optional: Resend, Cloudinary and Twilio accounts. The app runs without them —
  email is logged, SMS codes print to the console, uploads are disabled.

## First run

```bash
cp .env.example .env    # remove the stray "[TEMPLATE]" first line
# set DATABASE_URL and BETTER_AUTH_SECRET (32+ random characters)
npm install
npm run db:generate
npm run db:migrate
npm run db:seed         # demo users, venues, activities, circles + the location tree
npm run dev             # http://localhost:3000/en
```

Sign in with a seeded email or username and the demo password
(`Apon2026demo`): `admin@apon.app` (admin), `nusrat@apon.app` (host),
`ayesha.1@example.com` (member). The seed prints the generated usernames.

In development, verification and reset codes are stored in the `verifications`
table (query by email); they are not sent anywhere unless `RESEND_API_KEY` is set.

> `npm run db:seed` truncates every table in the public schema. Only run it
> against a disposable local database.

## Environment variables

Validated once in `lib/env.ts`; a missing/malformed required value fails at import
with a readable message.

| Variable                                                                 | Required   | Behavior                                                              |
| ------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | yes        | Must start with `postgres://` or `postgresql://`                      |
| `BETTER_AUTH_SECRET`                                                     | yes        | ≥16 chars; use 32+ random chars                                       |
| `BETTER_AUTH_URL`                                                        | no         | Default `http://localhost:3000`; must match the served origin         |
| `NEXT_PUBLIC_APP_URL`                                                    | no         | Default `http://localhost:3000`; trusted origin and email links       |
| `RESEND_API_KEY`                                                         | production | Empty in dev → email is logged; production throws on send failure     |
| `EMAIL_FROM`                                                             | no         | Default `APON <onboarding@resend.dev>`                                |
| `SMS_PROVIDER`                                                           | production | `console` in dev; production runtime requires `twilio`                |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`               | production | All three are required for production SMS OTP delivery                |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | optional   | All three needed; or use `CLOUDINARY_URL`                             |
| `CLOUDINARY_FOLDER`                                                      | no         | Default `apon`                                                        |
| `CLOUDINARY_API_BASE`                                                    | no         | Test-only override for the local Cloudinary stand-in                  |
| `MATCHING_DAY`                                                           | no         | 0=Sun…6=Sat, default 1; scheduling convention (external cron decides) |

Secrets are server-only: never add `NEXT_PUBLIC_` to any credential, and never
commit `.env`.

## Scripts

| Script                            | What it does                                                    |
| --------------------------------- | --------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js dev / production build / production server              |
| `npm run typecheck`               | `tsc --noEmit`, strict                                          |
| `npm run lint`                    | ESLint 9 flat config (`next/core-web-vitals` + TS)              |
| `npm run format`                  | Prettier, including Tailwind class sorting                      |
| `npm run test` / `test:watch`     | Vitest unit suite                                               |
| `npm run test:e2e`                | Playwright; starts `npm run dev` unless `E2E_BASE_URL` is set   |
| `npm run db:generate`             | Generate SQL from `lib/db/schema.ts`                            |
| `npm run db:migrate`              | Apply `drizzle/` via `scripts/migrate.ts`                       |
| `npm run db:push`                 | Push schema directly — local prototyping only                   |
| `npm run db:seed`                 | Truncate + rebuild demo data + full location tree               |
| `npm run geo:sync`                | Upsert the location tree only (safe on existing data)           |
| `npm run geo:build`               | Regenerate `lib/geo/data/bd-admin.json` from the source dataset |
| `npm run matching`                | Weekly matching run                                             |
| `npm run reminders`               | 24-hour activity reminders                                      |
| `npm run feedback`                | Feedback requests for completed activities                      |
| `node scripts/generate-icons.mjs` | Rebuild PWA icons, Apple icon and favicon                       |

All database scripts load `.env` themselves and run with
`--conditions=react-server` so `server-only` modules import correctly.

`scripts/apply-migration.mjs` is a one-off historical fix with a hardcoded local
connection string. Do not use it as a migration mechanism or point it at shared
data.

## Task recipes

### Add a page

1. Put it under the correct route group (`(marketing)`, `(auth)`, `(app)`,
   `(admin)`); the locale is already resolved by `app/[locale]/layout.tsx`.
2. Guard it: `requireUser`, `requireOnboarded`, `requireRole`, `requirePermission`
   or `requireAdmin` from `lib/session.ts`.
3. Read data through a function in `lib/queries/` — pages do not query directly.
4. Translate with `getTranslations("<namespace>")`; add keys to both catalogs.
5. If the path is protected, classify it in `ruleFor` (`lib/rbac.ts`).
6. Add it to the relevant nav (`components/features/nav/*` or
   `components/features/admin/admin-shell.tsx`).

### Add a mutation

```ts
"use server";
import "server-only";

import { ActionError, type ActionContext, createAction } from "@/lib/actions/action";
import { someSchema } from "@/lib/validations";

export const doThing = createAction({
  schema: someSchema,
  authorize: "user", // or "verified-phone" | "admin"
  rateLimit: { key: "message" }, // optional, see lib/rate-limit.ts
  revalidate: ["/things"],
  handler: async (input, { user }: ActionContext) => {
    // verify ownership/membership here
    if (!allowed) throw new ActionError("errors.unauthorized");
    return { id: 1 };
  },
});
```

- Declare the schema in `lib/validations` and reuse it in the client form.
- Annotation `(input, { user }: ActionContext)` is required: without it TypeScript
  collapses `TResult` to `unknown` for callers.
- Return translation keys via `ActionError`; unexpected errors become
  `errors.generic` and are logged server-side only.
- Call it from a client component with `useActionState`; show errors with
  `use-error-message` + `sonner`.

### Add a query

`lib/queries/<domain>.ts`, `import "server-only"`, select only what the page needs,
join locations/interests for display names, filter `deleted_at is null`, and use
`cache()` if a layout and page both need it.

### Change the schema

1. Edit `lib/db/schema.ts`.
2. `npm run db:generate`; inspect the SQL in `drizzle/`.
3. `npm run db:migrate`.
4. Update `docs/data-model.md`, inferred types and any `select()` that assumed the
   old shape.
5. Prefer additive changes; existing tables hold history and `geo:sync` relies on
   stable ids.

### Add a translation

Add the key under the same namespace in `messages/en.json` and
`messages/bn.json`. Never inline English strings in components or return prose
from actions. For a new namespace, confirm both catalogs have it (21 today).

### Add an upload purpose

1. Extend `UPLOAD_PURPOSES` and `UPLOAD_POLICIES` in `lib/uploads/policy.ts`
   (kinds, max size, public/private, folder, role).
2. Accept it in the form and validate ownership with `resolveOwnedImage` or
   `resolveOwnedAttachment`.
3. Add cases to `tests/unit/uploads.test.ts` and document it in `README.md` and
   `docs/data-model.md`.

### Add a job

Idempotent logic in `lib/jobs/<name>.ts` (check the `notifications` table before
sending), a thin `scripts/<name>.ts` runner with the standard header, an npm
script, and a cron entry in `docs/operations.md`.

### Add a location level

Update `LOCATION_LEVELS` and `CHILD_LEVELS` in `lib/geo/levels.ts`, the builder in
`lib/geo/build.ts`, the sync, and `tests/unit/geo.test.ts`. Existing rows are
upserted by slug, so ids survive.

## Testing

### Unit (Vitest)

`npm run test` runs `tests/unit/**/*.test.ts` in Node with the `@` alias. The suite
covers the pure rules and the action wrapper:

| File                      | Covers                                                                        |
| ------------------------- | ----------------------------------------------------------------------------- |
| `matching.test.ts`        | Scoring, eligibility, grouping, zone partitioning                             |
| `waitlist.test.ts`        | Capacity, waitlist decisions, promotion order                                 |
| `action-wrapper.test.ts`  | Session/role/phone gates, Zod errors, rate limit, revalidation, error mapping |
| `auth-validation.test.ts` | Username, password, sign-up/sign-in/reset rules                               |
| `geo.test.ts`             | Tree shape, levels, slugs, zones                                              |
| `rbac.test.ts`            | Section classification and access decisions                                   |
| `uploads.test.ts`         | Policies, magic-byte sniffing, file names                                     |

Add unit tests for new pure logic rather than mocking the database.

### End-to-end (Playwright)

```bash
npm run db:seed          # tests expect seeded users and activities
npm run test:e2e
```

- Playwright starts `npm run dev` on port 3000 unless `E2E_BASE_URL` is set;
  `reuseExistingServer` is on, so an already-running dev server is used.
- Tests read OTPs from `verifications` through `tests/e2e/helpers/db.ts`
  (`DATABASE_URL` from `.env`). They delete `rate_limits` before each test.
- The suite creates users, changes and restores seeded passwords, and RSVPs — use
  a disposable database.
- Upload specs need the local Cloudinary stand-in:

  ```bash
  CLOUDINARY_CLOUD_NAME=apon-test \
  CLOUDINARY_API_KEY=test-key \
  CLOUDINARY_API_SECRET=test-secret-0123456789 \
  CLOUDINARY_API_BASE=http://127.0.0.1:4599 \
  npm run dev
  ```

  and the mock server from `tests/e2e/helpers/mock-cloudinary.ts`.

`admin.spec.ts` checks moderation and 403s, `messages.spec.ts` the bilingual UI,
and `smoke.spec.ts` the full sign-up → verify → onboard → phone → RSVP path.

### What to run

Run `typecheck` for every TS change, `lint` for new components/imports, and
`test` when you touch a covered rule. Only run E2E for auth/RBAC/onboarding/RSVP/
upload changes that need the real stack. Report anything you could not run.

## Conventions that bite

- **Imports:** use `@/…` everywhere. Client components must not import anything
  with `server-only` (directly or transitively), including `lib/env`, `lib/db`,
  `lib/session`, `lib/auth` and `lib/queries`.
- **Navigation:** `@/i18n/navigation`, never `next/link`, inside the app.
- **Dates:** `lib/dates.ts`; the UI timezone is Asia/Dhaka.
- **Classes:** `cn()` from `lib/utils`; Tailwind v4 tokens in
  `app/globals.css` (`bg-card`, `text-muted-foreground`, `border-border`, …), not
  raw colors.
- **Components:** primitives in `components/ui` (Radix + CVA), feature components
  grouped by domain. Keep pages thin.
- **Theme:** `bondhu-theme` in localStorage; the pre-paint script lives in
  `app/[locale]/layout.tsx`.
- **Comments:** explain the rule or the race, not the syntax.

## Troubleshooting

| Symptom                                  | Likely cause / fix                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Invalid environment variables` on start | Missing/malformed `.env`; the error lists the keys. Remove the `[TEMPLATE]` line.                          |
| `Couldn't find next-intl config file`    | `createNextIntlPlugin()` removed from `next.config.ts`.                                                    |
| Every route redirects to `/sign-in`      | No session, or `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` does not match the origin you opened.               |
| Signed-in member gets 403 on `/admin`    | Correct behavior. Use an admin account.                                                                    |
| Uploads disabled in the UI               | Cloudinary needs cloud name + API key + secret (or `CLOUDINARY_URL`).                                      |
| No verification code                     | In dev, read it from `verifications`; set `RESEND_API_KEY` for real email.                                 |
| `server-only` error in a script          | Run with `node --conditions=react-server --import tsx …` like the npm scripts.                             |
| Migration drift                          | Use `db:generate` + `db:migrate`; avoid mixing `db:push` with migration history on a shared DB.            |
| E2E cannot read OTPs                     | `DATABASE_URL` missing or the DB is not seeded; tests need the same DB the dev server uses.                |
| Confusing dates                          | Server formats with `date-fns`; the provider pins `Asia/Dhaka`. Do not use `toLocaleString` on the server. |
