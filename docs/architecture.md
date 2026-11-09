# Architecture

APON is one Next.js 16 App Router application. There is no separate backend: pages,
Server Actions, the auth handler and scheduled scripts all run in the same Node
process and talk to PostgreSQL through Drizzle.

## Stack

| Concern         | Choice                                                                    | Where                                |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| Framework       | Next.js 16 (App Router, `proxy.ts`)                                       | `app/`, `proxy.ts`, `next.config.ts` |
| UI              | React 19, Tailwind v4, Radix primitives, framer-motion, sonner            | `components/`                        |
| Language / i18n | TypeScript strict, next-intl (en, bn, always prefixed)                    | `i18n/`, `messages/`                 |
| Database        | PostgreSQL + Drizzle ORM (postgres-js driver)                             | `lib/db/`                            |
| Auth            | Better Auth: email/username + password, email OTP verification, phone OTP | `lib/auth.ts`                        |
| Validation      | Zod, schemas shared by client and server                                  | `lib/validations/`                   |
| Email           | Brevo API + React Email templates                                         | `lib/email/`                         |
| SMS             | Console (default) or Twilio                                               | `lib/sms/`                           |
| Uploads         | Cloudinary signed uploads                                                 | `lib/uploads/`, `lib/cloudinary.ts`  |
| Tests           | Vitest (unit), Playwright (E2E)                                           | `tests/`                             |

## Runtime shape

```
                       ┌──────────────────────────────────────────┐
  Browser ────────────►│ proxy.ts                                 │
                       │  1. /api/auth/* → auth.handler           │
                       │  2. ruleFor + decideAccess (RBAC, 403)   │
                       │  3. next-intl (locale prefix)            │
                       └───────────────┬──────────────────────────┘
                                       │
                      ┌────────────────▼─────────────────┐
                      │ app/[locale]/(group)/layout.tsx  │  require*() guard
                      │ page.tsx (Server Component)      │  lib/queries/*
                      └───────┬──────────────────┬───────┘
                              │                  │
             client form ─────┘                  └────► Drizzle ──► PostgreSQL
             (useActionState)                            ▲
                    │                                    │
                    └──► lib/actions/* (createAction) ───┘
                              │
                              ├─ lib/email (Brevo) / lib/notify (in-app)
                              └─ lib/uploads → Cloudinary
```

External services are optional in development: without `BREVO_API_KEY` email
sending is logged, without Twilio SMS codes are printed, and without full
Cloudinary credentials uploads are disabled (the UI reports it).

## Layers

| Layer                      | Responsibility                                                                                   | Must not                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `proxy.ts`                 | Forward auth API, classify the path, redirect signed-out users, return real 403s, prefix locales | Contain business logic or DB writes                    |
| `app/**/layout.tsx`        | Authoritative guard (`requireAdmin`, `requirePermission`, …), shell/navigation                   | Fetch data a page should own                           |
| `app/**/page.tsx`          | Compose a page from queries and components, resolve translations                                 | Write data                                             |
| `lib/queries/*`            | Read-only Drizzle queries shaped for pages                                                       | Mutate                                                 |
| `lib/actions/*`            | Mutations through `createAction` (auth, rate limit, Zod, write, revalidate)                      | Return raw errors or leak internals                    |
| `lib/matching`, `lib/rsvp` | Pure domain rules + one orchestration module                                                     | Import React or HTTP                                   |
| `lib/db`                   | Schema, relations, client                                                                        | Encode policy                                          |
| `lib/rbac.ts`              | Section rules, roles and permissions                                                             | Import I/O (it is shared with the proxy, UI and tests) |

## Request lifecycle

1. **Proxy** (`proxy.ts`)
   - `/api/auth` and everything below it is handed to `auth.handler(request)`;
     the project ships no API routes.
   - The locale prefix is split off. Public sections return to next-intl without a
     session lookup; everything else loads the session and the full `users` row.
   - Deleted or suspended accounts are redirected to sign-in and their session
     cookies are cleared.
   - `decideAccess` returns `allow`, `redirect` (sign-in with `?next=`, onboarding,
     role home) or `forbidden` (rewrite to the localized 403 page with status 403).
2. **Layout** re-checks authorization with `requireUser`, `requireRole`,
   `requirePermission`, `requireAdmin`, `requireHost`, `requireOnboarded` or
   `requireVerifiedPhone`. `getCurrentUser` is `cache()`d, so layout + page share
   one user query per request.
3. **Page** reads through `lib/queries/*` and renders server markup.
4. **Mutation** comes from a client form as a Server Action. `createAction`
   performs session/suspension, authorization level, named rate limit, Zod parse,
   handler, then `revalidatePath` / `revalidateTag`. Results are
   `{ ok: true, data }` or `{ ok: false, error, fieldErrors? }`, where `error` is a
   translation key (e.g. `activities.detail.verifyPhoneToJoin`) rendered in the
   user's language.
5. **Side effects** — in-app notifications through `notify()` and emails through
   typed senders — are best-effort and never fail the write.

## Route map

Route groups are invisible in the URL.

| URL                                                                      | Group         | Access                                                        |
| ------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------- |
| `/`, `/guidelines`, `/credits`                                           | `(marketing)` | anyone                                                        |
| `/sign-in`, `/sign-up`, `/verify`, `/forgot-password`, `/reset-password` | `(auth)`      | signed-out only; signed-in users are redirected to their home |
| `/home`, `/activities`, `/activities/:id`, `/circles`, `/circles/:id`    | `(app)`       | any role, onboarded (admins exempt)                           |
| `/profile`, `/profile/:id`, `/settings`, `/onboarding`, `/dashboard`     | `(app)`       | signed in; `/dashboard` redirects to the role home            |
| `/host`                                                                  | `(app)`       | any role (it doubles as the "apply to host" page)             |
| `/host/new`, `/host/:id`, `/host/:id/edit`                               | `(app)`       | host, admin, onboarded                                        |
| `/admin/**`                                                              | `(admin)`     | admin                                                         |
| `/en/access-denied`                                                      | `[locale]`    | rendered by the proxy rewrite for 403s                        |
| `*`                                                                      | catch-all     | `notFound()`                                                  |

`lib/rbac.ts` maps path segments (after the locale) to a `Section`
(`public | auth | member | host | admin`), the roles allowed, and whether
onboarding is required. Add new protected paths there or they will default to
public.

### Fine-grained permissions

`can(role, permission)` grants `activities.host` to hosts and every permission to
admins. Admin pages still call their own `requirePermission("admin.locations")`
style guard, and actions use `authorize: "admin"` for the whole panel.

## Authentication

Better Auth with the `username`, `emailOTP` and `phoneNumber` plugins.

- **Sign-up** creates an unverified account and emails a 6-digit code. There is no
  session until `/verify` succeeds (`autoSignInAfterVerification`).
- **Sign-in** accepts one identifier field; the form routes to
  `/sign-in/email` or `/sign-in/username`.
- **Password reset** uses an emailed code and revokes every session.
- **Password policy** (8–128 chars, a letter, a number, not containing the
  username/email) runs in the form and in a Better Auth `before` hook.
- **Phone OTP** only attaches a verified number to a signed-in account; it can
  never sign in.
- **Rate limits** are stored in Postgres (`rate_limits`) with per-endpoint rules.
- Sessions are database-backed httpOnly, SameSite=Lax, 30 days, `Secure` in
  production.

Email codes are stored plain in development/test (Playwright reads the
`verifications` table) and hashed in production.

## Domain flows

### Sign-up → onboarding → matching

```
sign up ─► verify email code ─► /onboarding
                                 ├─ interests (3–8)
                                 ├─ area (from the 5,924-node location tree)
                                 ├─ availability (weekday × morning/afternoon/evening)
                                 ├─ preferences (group size, women-only, mode, language)
                                 └─ guidelines accepted → users.onboarded_at
                                        │
                                        ▼
                      weekly `npm run matching` (external scheduler)
                                        │
                     pool: active, onboarded, phone-verified, not in a circle
                                        │
                        zone × womenOnly buckets → groups of 4–6
                                        │
        circle (forming) + members (invited) + time poll + notifications + email
```

Matching is split in two:

- `lib/matching/core.ts` is pure. Pair score = interest Jaccard × 50 +
  availability overlap × 30 + age within ±5 years (+10) + language compatibility
  (+10). Pairs are only eligible in the same zone and women-only setting, and never
  if blocked or previously in a circle together with a member who left. Candidates
  with the fewest eligible partners seed first; each group then greedily adds the
  candidate with the best average score, targeting 5 (small) or 6 (medium) and
  requiring at least 4. Leftovers stay in the pool.
- `lib/matching/index.ts` loads the pool, builds the exclusion context, persists
  circles/members/poll/notifications in a transaction per group, and emails
  invites. It is also callable from **Admin → Circles → Re-run matching**.

### Circle lifecycle

The matching run creates a circle as `forming` and each member as `invited`.
Invited members see the invitation on `/circles` and `/circles/:id`; accepting
marks them `active`, declining marks them `declined`. The circle becomes
`active` when at least three members have accepted. While invitations are still
pending, active members of a `forming` circle can already chat and vote.

Leaving marks the membership `left`. If fewer than three active members remain
and invitations are still pending, the circle returns to `forming`; if nobody is
left to answer, it is archived and the remaining members return to the matching
pool. All circle reads and actions require an `active` membership on a
non-archived, non-deleted circle.

### Activities and RSVP

```
host creates activity (pending) ─► admin approves (approved) ─► members RSVP
                                                                  ├─ going (seat)
                                                                  └─ waitlist (full)
cancel ─► first waitlisted member promoted, notified + emailed
complete ─► 24h reminder job, then feedback request job
```

- Host tools are gated by `requireHost`; only the owning host or an admin can edit.
- RSVP runs in a transaction with `SELECT … FOR UPDATE` on the activity, so
  capacity cannot be oversold. The pure decision rules live in
  `lib/rsvp/waitlist.ts`.
- RSVP requires a verified phone and rejects cancelled/pending/started activities
  and women-only activities for non-female members.
- The exact venue address and map link are withheld until the member is `going`
  (`getActivityDetail`).
- Admins review activities and can approve, reject/cancel or complete them.

### Trust and safety

Members can report a user, activity or message (optional private evidence) and
block others. Blocked pairs are excluded by matching, and blocking hides mutual
circle content where the code checks it. Admins resolve reports in
`/admin/reports`. Suspending a member deletes their sessions immediately, and the
proxy then signs them out on the next request.

### Feedback and the north-star metric

After a completed activity, `npm run feedback` asks each attendee who has not
already submitted feedback. The admin metrics page treats **members who met the
same circle 3+ times** as the north star, alongside attendance, repeat attendance,
comfort and median days from sign-up to circle.

## Cross-cutting concerns

### Internationalisation

- `i18n/routing.ts`: locales `en` / `bn`, default `en`, `localePrefix: "always"`.
- `i18n/request.ts` statically imports both catalogs (no computed import path).
- `i18n/navigation.ts` exports locale-aware `Link`, `redirect`, `usePathname`,
  `useRouter`, `getPathname`.
- Server code uses `getTranslations`, client code `useTranslations`.
- The `NEXT_LOCALE` cookie also selects the language of auth emails.
- `messages/*.json` has 21 namespaces; both files must stay structurally in sync.

### Uploads

One server action (`uploadFile`) handles every file:

```
session → purpose policy role → rate limit (20 / 10 min) →
size → magic-byte sniff (jpeg/png/webp/pdf) → signed Cloudinary upload →
uploads row owned by the caller
```

Images are resized on upload (which strips EXIF/GPS). Public purposes are CDN
URLs; private purposes use Cloudinary `authenticated` and a 10-minute signed link
for admins. Forms may only save uploads owned by the same user for the same
purpose (`resolveOwnedImage`, `resolveOwnedAttachment`). Replaced and deleted
assets are cleaned up best-effort, and account deletion removes public images.

### Notifications and email

`notify()` writes an in-app notification and never throws into the caller.
Typed email senders cover verification/reset codes, account-exists, circle
invites, activity reminders, waitlist promotion, host approval and feedback
requests. Jobs are idempotent by checking existing `notifications` rows.

### Rate limiting

Postgres fixed-window counters in the shared `rate_limits` table. Better Auth
endpoints have their own rules; app mutations use `lib/rate-limit.ts`
(`rsvp`, `message`, `report`, `feedback`, `circleRequest`, `circleMutation`,
`poll`, `safety`, `profile`, `locationSearch`, `upload`, `otpRequest`) plus the
`createAction` rate-limit option. Location lookups apply the same database-backed
limiter directly because they are read-only server functions rather than mutations.

### Rendering and caching

`cacheComponents` is disabled: the app reads live data per request, which keeps
Server Actions and guards predictable. `unstable_cache` is used only for the
public landing stats. After a write, actions revalidate the affected collection
paths and, for activities, the `activities` tag.

## Deliberate constraints and gaps

- **Single-node Next.js.** No queue or worker: scheduled work is external cron
  invoking the scripts in `scripts/`. There is no realtime transport; circle chat
  updates on revalidation/refresh.
- **No API layer for app features.** Server Actions replace REST; only
  `/api/auth/*` exists.
- **No deletion of history.** Users, venues, circles and uploads are soft-deleted
  so references stay valid.
- **No PG enums.** Status columns are `text` + Zod; adding a value is a code change
  plus a docs change, not a migration.
- **`users.area_id` has no foreign key**, and a few status invariants are enforced
  only in application code — read `docs/data-model.md` before writing SQL by hand.
