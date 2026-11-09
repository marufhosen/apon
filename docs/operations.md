# Operations

APON is a single Next.js server backed by PostgreSQL. There is no job queue, no
worker process and no realtime service: background work is external cron calling
the npm scripts, and the app must be reachable at a stable origin for auth
callbacks and email links.

## Runtime requirements

| Piece        | Requirement                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| App          | Node.js 20.9+, `npm run build` then `npm run start` (default port 3000)                                            |
| Database     | PostgreSQL reachable via `DATABASE_URL`; run migrations before starting a new build                                |
| Origin       | `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be the public https origin; `trustedOrigins` uses the latter      |
| Request body | Server Action limit is 9 MB; the proxy buffers up to 10 MB. Any reverse proxy must allow at least that for uploads |
| Outbound     | HTTPS to `api.brevo.com`, `api.cloudinary.com`, `res.cloudinary.com`, and Twilio if enabled                        |

The repo contains no Dockerfile, CI workflow or platform config. Deploy it as a
standard Next.js Node server; do not treat `next export` as supported — auth,
Server Actions and dynamic pages need the server runtime.

## Environment checklist

Production:

- `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random chars), `BETTER_AUTH_URL`,
  `NEXT_PUBLIC_APP_URL`
- `BREVO_API_KEY` + `BREVO_SENDER_EMAIL` — required; without them verification
  and reset emails cannot be delivered and production startup fails. The sender
  must be registered and active in Brevo. `BREVO_SENDER_NAME` defaults to `APON`.
- Cloudinary credentials if uploads are enabled
- `SMS_PROVIDER=twilio` plus all Twilio credentials — the production runtime
  fails fast without working SMS because RSVP depends on phone verification

Development/test may omit all integrations; behavior is described in
`docs/development.md`.

Secrets stay in the host's secret store or an untracked `.env`. Never put a
credential in `messages/`, `public/`, or any `NEXT_PUBLIC_` variable.

## Scheduled jobs

Jobs are idempotent and safe to re-run. Schedule them in the host's cron (or any
external scheduler) from the deployed working directory with environment
variables available.

| Job                | Command             | Suggested schedule (Asia/Dhaka)  | Idempotency                                                                                    |
| ------------------ | ------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Weekly matching    | `npm run matching`  | Mondays 09:00 (`MATCHING_DAY=1`) | Creates circles/polls/notifications once per run; pool excludes members already invited/active |
| Activity reminders | `npm run reminders` | Hourly (`0 * * * *`)             | Skips when an `activity_reminder` notification exists for that user + activity                 |
| Feedback requests  | `npm run feedback`  | Daily 21:30 (`30 21 * * *`)      | Skips existing `feedback_request` notifications and submitted feedback                         |
| Location sync      | `npm run geo:sync`  | Only after a dataset update      | Upserts by slug; never deletes admin rows                                                      |

`npm run matching` is also exposed to admins in **Admin → Circles → Re-run
matching**; avoid running both at the same time.

Operational notes:

- Run one matching process at a time. It is not guarded by an advisory lock.
- Job scripts exit non-zero on failure; alert on the exit code and on empty output.
- Matching and reminders call Brevo inside the job. Email failures are logged and
  do not fail the run, so check logs if members report missing mail.
- Emails are best-effort by design; in-app notifications are the source of truth.

## Migrations and seeding

```bash
npm run db:generate   # produce SQL in drizzle/ (commit it with the code change)
npm run db:migrate    # apply every pending migration
```

- Run migrations as a release step, before the new server starts.
- `drizzle/` is gitignored in this checkout; confirm the team's convention before
  relying on generated files surviving a clone.
- Do **not** run `npm run db:seed` outside a disposable environment: it truncates
  every table and rebuilds demo data.
- `npm run geo:sync` is the only reference-data operation that is safe on
  production: it upserts the ~5,924 locations by slug, keeps existing ids, and
  leaves admin-added villages alone.

## Data operations

| Operation          | Effect                                                                      | Reversible                                       |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------ |
| Suspend a member   | Sets `status = suspended`, deletes their sessions; proxy signs them out     | Yes, restore in Admin → Users                    |
| Delete a venue     | Soft delete + unapprove                                                     | Yes, in the database                             |
| Cancel an activity | Status `cancelled`, waitlist untouched                                      | Yes, re-approve                                  |
| Delete an account  | Soft delete, cancel RSVPs, leave circles, delete sessions and public images | Partially (history is retained; images are gone) |
| Resolve a report   | Status + reviewer + note; reporter notified                                 | Yes, in the database                             |

There is no admin UI for hard deletion, and none should be added casually: user,
venue, circle and upload rows are referenced by history.

## Security posture

- **Authorization:** three layers — proxy, layout guards, action guards. A path not
  classified in `lib/rbac.ts` defaults to public, so new protected routes must be
  added there.
- **Sessions:** database-backed httpOnly cookies, SameSite=Lax, `Secure` in
  production, 30-day expiry; password reset and suspension revoke sessions.
- **Passwords:** scrypt; policy enforced in forms and in a Better Auth hook.
- **OTPs:** 6 digits, short expiry, attempt limits, hashed at rest in production;
  email codes can never sign in, and phone OTP can only attach a number.
- **Rate limits:** database-backed for Better Auth endpoints and app mutations
  (`lib/rate-limit.ts`). They are per-key, not per-IP globally; a new abusable
  endpoint needs its own rule.
- **Uploads:** role check per purpose, 20 per 10 minutes, size limit, magic-byte
  type detection, random public ids, EXIF stripped by Cloudinary resize, SVG/HTML
  rejected, private assets via 10-minute signed links, ownership checks on save.
- **Data exposure:** exact venue addresses are withheld until an RSVP is `going`;
  circle content requires active membership; admin views of private attachments
  use signed URLs; raw errors never reach the client.
- **Logs:** errors are logged with context but never with secrets, session tokens
  or OTPs. Development prints dev-only email/SMS events.

## Observability

There is no third-party monitoring wired in. Useful log prefixes:

| Prefix                              | Source                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `[action]`                          | Unexpected Server Action failures (the client only sees `errors.generic`) |
| `[auth]`                            | Account-exists email failures                                             |
| `[email:dev]`, `[email:brevo:warn]` | Email fallback and delivery issues                                        |
| `[sms:dev]`, `[sms:otp:warn]`       | Console SMS and Twilio failures                                           |
| `[uploads]`                         | Cloudinary destroy/cleanup failures (best-effort)                         |
| `[matching]`                        | Invite email failures                                                     |
| `[reminders]`, `[feedback]`         | Job email failures                                                        |
| `[notify]`                          | Notification insert failures (never thrown)                               |

Metrics that matter to the product are already on **Admin → Metrics**: onboarding
completion, attendance, repeat attendance, average comfort, median days to a
circle and members who met the same circle 3+ times.

## Release checklist

1. `npm run typecheck`, `npm run lint`, `npm run test` pass.
2. Schema change? Generate, review and apply the migration to a staging DB and
   smoke-test sign-in, onboarding, RSVP and an upload.
3. `npm run build` succeeds.
4. Required env vars and secrets are set for the target origin.
5. Deploy the build, then run `npm run db:migrate` if it was not part of the
   release step.
6. Smoke-test in a browser: `/`, sign-in, onboarding or `/home`, one activity
   detail, one RSVP, and (if enabled) one upload.
7. Confirm the cron entries exist and that the last run produced output.
8. Roll back by redeploying the previous build; migrations must remain
   backward-compatible with the old code.

## Known operational gaps

- **No matching lock:** two concurrent runs can create duplicate circles.
- **No realtime:** circle chat updates on refresh/revalidation only.
- **No hosted job runner or CI:** scheduling and checks are external.
- **`scripts/apply-migration.mjs`** is a one-off with a hardcoded local URL; never
  run it against shared data.
