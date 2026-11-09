<p align="center"><img src="public/brand/apon-logo.svg" alt="APON — Everyone belongs" width="360"></p>

# APON — Everyone belongs

Bilingual (English / বাংলা) app that matches people anywhere in Bangladesh into small weekly circles of 4–6 and gives them hosted, real-world activities to meet at.

Next.js 16 (App Router, `proxy.ts`) · React 19 · Drizzle + PostgreSQL · Better Auth (email/username + password) · Resend · Cloudinary · next-intl · Tailwind v4.

## Documentation

| Document                                       | What it covers                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                       | The binding rulebook: layering rules, conventions, recipes, gotchas        |
| [`docs/architecture.md`](docs/architecture.md) | Request lifecycle, route map, authorization, matching, RSVP, uploads, i18n |
| [`docs/data-model.md`](docs/data-model.md)     | Tables, status values, invariants, soft deletes                            |
| [`docs/development.md`](docs/development.md)   | Setup, environment, scripts, task recipes, testing                         |
| [`docs/operations.md`](docs/operations.md)     | Jobs, deploy checklist, data operations, security                          |

## Getting started

```bash
cp .env.example .env          # set DATABASE_URL and BETTER_AUTH_SECRET
npm install
npm run db:generate && npm run db:migrate
npm run db:seed               # demo data + the full location tree
npm run dev
```

Sign in with any seeded email or username (e.g. `admin@apon.app` or `rafi.ahmed`) and the demo password `Apon2026demo`.
Without `RESEND_API_KEY`, development logs email events and stores verification codes in the `verifications` table (see `docs/development.md`).

## Authentication

Email/username + password, built on Better Auth (`lib/auth.ts`):

| Flow                                        | Page                                   | Endpoint                                                          |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Sign up (email, username, password)         | `/sign-up`                             | `POST /api/auth/sign-up/email`                                    |
| Verify email with a 6-digit code (required) | `/verify`                              | `POST /api/auth/email-otp/verify-email`                           |
| Sign in with email **or** username          | `/sign-in`                             | `POST /api/auth/sign-in/email` · `/sign-in/username`              |
| Forgot / reset password                     | `/forgot-password` → `/reset-password` | `/email-otp/request-password-reset` → `/email-otp/reset-password` |
| Change password, sign out other devices     | Settings → Password & security         | `/change-password` · `/revoke-other-sessions`                     |

- Codes are sent through Resend with `RESEND_API_KEY` and `EMAIL_FROM` (server-only).
  In production a missing key makes sending fail loudly instead of logging the code.
- Passwords: scrypt hashes (Better Auth). 8–128 characters with a letter and a number,
  and they can't contain the username or email. The same rules run in the forms and in a
  server hook (`lib/validations/auth.ts`).
- Usernames: 3–30 letters, numbers, `.` or `_`. Unique and case-insensitive; reserved names
  are blocked.
- Sessions: database-backed httpOnly, SameSite=Lax cookies (`Secure` in production),
  30 days. A password reset revokes every session.
- Abuse protection: rate limits on every auth endpoint. Duplicate-email sign-ups get the same
  response as new ones (the owner is emailed instead), and sign-in errors stay generic.
  Verification codes are hashed at rest in production.
- The old passwordless email-code and phone-code sign-ins are disabled. Phone OTP is only
  used to attach a verified number in Settings.
- Production runtime requires `SMS_PROVIDER=twilio` and all three Twilio credentials because
  verified phone numbers gate RSVP. A misconfigured production process fails at startup.
- **Existing accounts** created with email codes have no password. They set one with
  _Forgot password_ (the reset creates the password).

## Uploads (Cloudinary)

Images and files go through one server action, `uploadFile` in `lib/actions/uploads.ts`,
and are stored on Cloudinary.

| Purpose                   | Who           | Types · max             | Visibility                |
| ------------------------- | ------------- | ----------------------- | ------------------------- |
| Profile photo             | any member    | JPG/PNG/WebP · 5 MB     | public CDN                |
| Activity cover            | hosts, admins | JPG/PNG/WebP · 5 MB     | public CDN                |
| Venue photo               | admins        | JPG/PNG/WebP · 5 MB     | public CDN                |
| Report evidence           | any member    | JPG/PNG/WebP/PDF · 8 MB | **private** (admins only) |
| Host-application document | any member    | JPG/PNG/WebP/PDF · 8 MB | **private** (admins only) |

- **Credentials stay on the server.** Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
  `CLOUDINARY_API_SECRET` (or a single `CLOUDINARY_URL`). Signed uploads need the secret;
  with only the API key, uploads stay disabled and the UI says so.
- **Validation:** checked in the browser for quick feedback and again on the server, which is
  what counts. The server enforces role per purpose, rate limit (20 per 10 minutes), size, and
  the real file type from its first bytes (magic bytes). SVG, HTML and GIF are rejected
  whatever the file is called.
- **Safe storage:** random public ids. Images are resized when they arrive, which also strips
  EXIF/GPS data. Private files use Cloudinary's `authenticated` type; admins open them through
  a signed link that expires after 10 minutes.
- **Ownership:** the `uploads` table records who uploaded what. Profiles, activities, venues,
  reports and host applications only accept the caller's own uploads, so arbitrary URLs can't
  be injected. A replaced or removed image is deleted from Cloudinary, and deleting an
  account removes that member's public images.

## Locations (nationwide)

`areas` is one adjacency-list tree of **5,924 places**:

```
division → district → upazila → union → village
                    → city corporation → thana → area (Gulshan 2, Agrabad, …)
                                       → ward
```

- 8 divisions, 64 districts, 494 upazilas and 4,536 unions come from the BBS-derived
  [nuhil/bangladesh-geocode](https://github.com/nuhil/bangladesh-geocode) dataset
  (`lib/geo/data/bd-admin.json`, regenerate with `npm run geo:build`).
- 12 city corporations, 113 metropolitan thanas, 480 wards and 217 neighbourhoods are
  curated in `lib/geo/data/urban.ts`.
- Villages: no open nationwide dataset is bundled. Admins add villages and neighbourhoods
  under any union, thana or ward in **Admin → Locations**.
- `npm run geo:sync` upserts the tree by slug **without touching other data**, so it is
  safe on an existing database: users, venues and activities keep their location ids.
- Matching zones: neighbourhood clusters in Dhaka, city-wide elsewhere, by upazila in
  rural areas. Children inherit their parent's zone.

## Panels & access control

`lib/rbac.ts` is the single policy, used by the proxy, the layouts and the navigation:

| Section     | Paths                                                                | Roles               |
| ----------- | -------------------------------------------------------------------- | ------------------- |
| Public      | `/`, `/guidelines`, `/credits`                                       | anyone              |
| Auth        | `/sign-in`, `/verify`                                                | signed-out only     |
| User Panel  | `/home`, `/activities`, `/circles`, `/profile`, `/settings`, `/host` | member, host, admin |
| Host tools  | `/host/new`, `/host/:id/**`                                          | host, admin         |
| Admin Panel | `/admin/**`                                                          | admin               |

Checks happen in three layers. `proxy.ts` handles redirects and returns real HTTP 403s.
Layouts and pages call `requireRole` / `requirePermission`, which use `forbidden()`.
Server Actions go through `createAction({ authorize })`. After sign-in, `/dashboard`
sends admins to the Admin Panel and everyone else to the User Panel.

## Scripts

| Script                                        | What it does                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test`                                | unit tests (matching, waitlist, actions, geo tree, RBAC)                                                                                                                                                                                                                                                          |
| `npm run test:e2e`                            | Playwright tests against a dev server. Upload tests need the dev server started with `CLOUDINARY_CLOUD_NAME=apon-test CLOUDINARY_API_KEY=test-key CLOUDINARY_API_SECRET=test-secret-0123456789 CLOUDINARY_API_BASE=http://127.0.0.1:4599`; they run a local stand-in for Cloudinary that verifies every signature |
| `node scripts/generate-icons.mjs`             | regenerate PWA icons, Apple icon and favicon from the APON mark                                                                                                                                                                                                                                                   |
| `npm run geo:sync`                            | load/refresh the location tree only                                                                                                                                                                                                                                                                               |
| `npm run matching` / `reminders` / `feedback` | scheduled jobs                                                                                                                                                                                                                                                                                                    |

## Brand

**APON** (আপন — "one's own people"). Tagline: _Everyone belongs_ · _সবাই আপন_.

The mark is an open ring (the circle) with a warm dot in its gap: there is always a place for you.
Sources: `public/brand/apon-mark.svg`, `public/brand/apon-logo.svg`, `app/icon.svg` (favicon),
`components/brand/logo.tsx` (in-app). Brand colours: teal `#0f766e`, amber `#fbbf24`.
