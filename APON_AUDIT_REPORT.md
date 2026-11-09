# APON (আপন) — Comprehensive Website & Codebase Audit

**Audit date:** 9 November 2026  
**Repository:** `bondhu-circle` (product name: APON)  
**Stack reviewed:** Next.js 16.4.1 (App Router, `proxy.ts`), React 19, PostgreSQL + Drizzle ORM, Better Auth, next-intl (English / বাংলা), Tailwind CSS v4, Cloudinary, Resend, Twilio-compatible SMS  
**Audit type:** Static audit, schema review, route trace, build verification, and automated checks

**Remediation status:** Updated after the first remediation pass. Resolved issue cards were removed; remaining issues and the action plan reflect the current code.
**Deliverable:** a living remaining-issues report, not a snapshot of the original codebase.

> **Basis labels used throughout**
>
> - **Confirmed** — reproduced by code inspection, build output, query trace, or an automated check.
> - **Risk** — a credible failure mode or security/privacy exposure that follows from the code but was not exercised end-to-end.
> - **Missing** — functionality the product description implies but the implementation does not contain.
> - **Recommendation** — hardening or product work that is not a defect in the current code.
>
> Severity is judged for a public launch of a safety-sensitive social product in Bangladesh, not merely for code cleanliness.

---

## A. Executive Summary

### A.1 Overall project health

APON has changed materially since the original audit. The core circle journey now works end to end: matching creates `forming` circles, invitees can accept or decline, a circle activates once three members accept, and members can chat, vote and leave. Poll voting is scoped per member, the notification centre exists, notification preferences suppress both channels, attendee identities are scoped, profile privacy controls are enforced, report moderation can preview and hide a message, rematch requests can be resolved, activity capacity/cancel/check-in guards exist, account deletion removes identity and private uploads and notifies attendees, email/phone uniqueness is database-enforced, SMS no longer logs codes and propagates delivery failures, and security headers are live.

The remaining launch blockers are mostly operational, legal and product-scope rather than core data loss: there is no privacy policy, terms page or sign-up consent; no monitoring, CI or committed migrations; and the advertised social graph (discovery, connections, DMs, communities, posts) does not exist. A smaller set of High issues remains: activity lifecycle e-mails still link to the activity board, production only warns when SMS is unconfigured, account deletion does not recompute affected circles, and editing an activity does not notify attendees.

### A.2 Scorecard

| Area | Rating | Summary |
| --- | --- | --- |
| Architecture & layering | ★★★★☆ | Clear route groups, action wrapper, query layer, pure domain logic. A few boundary leaks and dead exports. |
| Authentication | ★★★★☆ | Password + email OTP + phone OTP + reset + session revocation; unique email/phone indexes. Missing 2FA, email change, and fail-fast boot without SMS. |
| Authorization / RBAC | ★★★★☆ | Layered and mostly consistent; real 403s; ownership checks on uploads and hosted activities. A few ungated reads remain. |
| Database & integrity | ★★★★☆ | Broad, sensible schema with soft deletes and useful indexes. Poll vote loss and duplicate email are fixed; waitlist races, list bounds and uncommitted migrations remain. |
| Core circle journey | ★★★★☆ | Match → accept/decline → activation → chat/vote works. Poll closing, leave consistency and chat pagination are still missing. |
| Activities & RSVP | ★★★★☆ | Strong capacity transaction, waitlist, address gating, cancel/check-in guards. Edit notifications, feedback completion and past re-approval need work. |
| Social features (connections, DMs, communities, posts) | ★☆☆☆☆ | Not implemented. The product currently offers automatic circles + circle chat, not a general social network. |
| Notifications | ★★★★☆ | Notification centre, read actions, in-app/email preference enforcement and invite deep links exist. Activity e-mails still link to the board; one-click unsubscribe is missing. |
| Safety & moderation | ★★★☆☆ | Reporting with target preview, message hiding, blocking and suspension exist. No admin audit log, appeal path or content screening. |
| Privacy | ★★★★☆ | Profile visibility, gender/age/area controls, blocked-profile hiding and scoped attendee lists are implemented. Data export is still missing. |
| UI / UX | ★★★★☆ | Consistent design system, mobile bottom nav, empty states, motion with reduced-motion support, good form primitives. Some broken edge journeys and untranslated data labels. |
| Internationalization | ★★★☆☆ | 975 keys in both catalogs, zero missing keys, bn copy is genuinely Bangla. Data names, validation messages, admin labels and server notifications still leak English. |
| Performance | ★★★☆☆ | No measurements. Proxy does a session + DB lookup per protected request; jobs are N+1; several lists are unbounded. |
| Security | ★★★★☆ | CSP/headers/HSTS, parameterized SQL, Zod, signed private uploads, cookie flags, rate limits. Dependency advisories and weak secret minimum remain. |
| SEO | ★★☆☆☆ | Landing page has title/description/hreflang/OG. No sitemap, robots.txt, canonical policy, per-page OG, JSON-LD, or noindex on private routes. |
| Testing | ★★★☆☆ | 93 unit tests across the pure domains; 21 Playwright cases exist. No automated coverage for the new circle lifecycle, polls, notifications, privacy or moderation; E2E not executed in this audit. |
| Operations | ★☆☆☆☆ | No monitoring, alerting, health check, CI, committed migrations/lockfile, backup/retention documentation, or concrete deploy configuration. |
| **Overall** | **★★★☆☆** | **Core journey and major safety gaps are fixed. Remaining blockers are legal, observability, release engineering and product scope. Production readiness: NO-GO.** |

### A.3 Top launch blockers

1. **No privacy policy, terms of service, or sign-up consent** (`LEGAL-01`) — a launch blocker for a platform handling gender, age and location data.
2. **No monitoring, alerting or health check** (`OPS-01`) — failures in matching, reminders, SMS or uploads would be invisible.
3. **No CI, deploy configuration, or committed migrations/lockfile** (`OPS-02`, `DATA-08`) — deployments are not reproducible.
4. **The advertised social graph is absent** (`DISC-01`) — discovery, connections, DMs, communities and posts do not exist.
5. **Activity lifecycle e-mails link to the board** (`CIRC-07`) — reminders, waitlist promotions and feedback e-mails do not deep-link to the activity.
6. **Production only warns when SMS is unconfigured** (`AUTH-02`) — phone OTP remains unusable without Twilio, though delivery now fails visibly and codes are not logged.
7. **Account deletion leaves circle state inconsistent** (`SAFE-03`) — memberships are removed without recomputing or notifying the remaining circle.
8. **Editing an activity does not notify attendees** (`DATA-01`) — time/venue/capacity changes are silent, and past activities can still be re-approved.

### A.4 What is genuinely strong

- **Circle lifecycle**: invite accept/decline, three-accept activation, `forming` visibility, member counts and deep links are implemented; poll votes are scoped per member.
- **Layered authorization**: `proxy.ts` performs the cheap check, route-group layouts call `requireRole` / `requireAdmin` / `requireHost`, and every mutation uses `createAction` with an `authorize` policy. A direct URL to `/en/admin/...` returns a real 403, not a silent redirect.
- **Upload security**: magic-byte typing, purpose-specific size/type policy, ownership resolution (`resolveOwnedImage` / `resolveOwnedAttachment`), private Cloudinary assets, and short-lived signed download links.
- **Privacy controls**: profile visibility, gender/age toggles, exact/zone/hidden area, blocked-profile hiding and scoped attendee identities are enforced at query time.
- **Location system**: a 5,924-node Bangladesh tree (division → district → upazila/thana → union/ward → area/village) with ancestor arrays, a GIN index, cascading pickers, search, and zone mapping for matching.
- **RSVP correctness**: the join/cancel path locks the activity row, computes capacity inside the transaction, promotes the oldest waitlisted member, and never exposes the exact address before `going`.
- **Bilingual catalogs**: 975 keys in `en.json` and `bn.json`, full parity, and the Bangla values are translated.
- **Server Actions discipline**: no ad-hoc app API routes; `/api/auth/*` is the only API surface; errors are translation keys, not raw exceptions.
- **UI system**: consistent Radix/CVA primitives, teal/amber palette, responsive grids, mobile bottom navigation with safe-area padding, empty states, and motion primitives that honour `prefers-reduced-motion`.
- **Code health**: `tsc --noEmit`, ESLint, the production build and the unit suite all pass; the pure domains (`matching/core`, `rsvp/waitlist`, `rbac`, `geo`, uploads, privacy) are isolated and tested.

### A.5 Production readiness decision

**NO-GO for public launch.** There are no open Critical issues, and a closed beta is now plausible after the pending migrations are applied and the core journeys are smoke-tested. Public launch still requires at least `LEGAL-01`, `OPS-01`, `OPS-02` and a reproducible release process. `DISC-01` is a product-scope decision: either build the advertised social graph or align the marketing and README with the circles-first product.

---

## B. Feature Inventory

### B.1 Fully implemented

| Feature | Evidence / notes |
| --- | --- |
| Email + username/password sign-up and sign-in | Better Auth `emailAndPassword` + `username` plugin; strong password and username schemas; rate limits; unique lower(email) and phone indexes. |
| Email OTP verification | 6 digits, 10-minute expiry, 5 attempts, hashed in production / plain in dev-test for E2E; resend through the same flow. |
| Password reset | OTP by email, session revocation, password update; E2E spec exists. |
| Phone OTP verification | BD-only validator, 6 digits, 5-minute expiry, 3 attempts; console provider refuses production and delivery errors propagate. Boot-time fail-fast is still missing (`AUTH-02`). |
| Session management | DB sessions, 30-day expiry, daily refresh, 1-day fresh age, httpOnly/SameSite/Secure cookies in production; suspension deletes sessions. |
| Onboarding | Interests (3–8), availability, group-size/women-only/language preferences, cascading area picker, guidelines acceptance, optional phone verification. |
| Profile view/edit and privacy | Name, gender, birth year, bio, area, avatar; profile visibility, gender/age toggles, exact/zone/hidden area; public profile excludes email and phone. |
| Circle lifecycle | Matching creates `forming` circles with invited members; accept/decline actions, three-accept activation, invitation notifications and member counts. Admin circle controls remain read-only (`ADMIN-03`). |
| Circle chat & time poll | Membership-gated message thread, reporting, blocked-message filtering, poll creation and per-member multi-select votes. Poll closing is still missing (`CIRC-09`). |
| Bangladesh location tree | 5,924 nodes, 8 levels, ancestor arrays, search, dependent selects, admin browsing, zone mapping used by matching. |
| Activity board | Filters (category, area at any level, date, price, women-only), URL state via nuqs, pagination, cards. |
| Activity detail & RSVP | Capacity transaction, waitlist, promotion, cancel, address/map gated to `going`, host card, reporting entry points, scoped attendee identities. |
| Host application & activity management | Apply, admin review, create/edit/cancel, capacity floor, cancel releases RSVPs, check-in only for `going`, cover upload, venue selection. |
| Notification centre | `/notifications` page, unread badge, per-item and mark-all read actions, empty state, RBAC route policy. |
| Notification preferences | In-app and email preferences are enforced by `notify()`, matching, reminders, feedback and waitlist promotion. |
| Moderation basics | Report user/activity/message with private evidence, admin target preview, message hide/restore, report resolution, block/unblock, suspension/restore, 403 pages. |
| Admin queues | Users, reports, host applications, activities, venues, locations, circles, metrics, rematch resolution. |
| Security baseline | CSP, HSTS, frame/nosniff/referrer/permissions headers, `poweredByHeader: false`, no hardcoded credentials, private upload links. |
| Bilingual product | 975 keys per locale, locale-prefixed URLs, localized email copy, Dhaka time zone in the client provider. |
| Uploads | Avatars, activity covers, venue photos, report evidence, host documents; signed Cloudinary flow; policy enforced twice. |
| Rate limiting | Postgres fixed windows: sign-in/sign-up/OTP, RSVP, message, report, feedback, host application, uploads, username availability. |
| PWA basics | Web manifest + 192/512 icons + apple icon; theme color; no documented offline behaviour. |
| Operational jobs | Weekly matching, 24-hour reminders, post-activity feedback requests, with notification-based idempotency. |

### B.2 Partially implemented

| Feature | What exists | What is missing / broken |
| --- | --- | --- |
| Circle lifecycle | Matching, accept/decline, quorum activation, chat and voting work. | Polls never close (`CIRC-09`); leaving can hide the circle from remaining members (`CIRC-08`); member list/pagination gaps (`CIRC-10`, `CIRC-11`). |
| Notifications | Centre, read actions, preference enforcement, invite/settings deep links. | Activity e-mails link to `/activities` rather than the activity (`CIRC-07`); no one-click unsubscribe token (`NOTIF-01`). |
| Moderation | Report target preview, message hide, resolution note, suspension. | Admin audit log (`SAFE-07`), appeals (`SAFE-06`), automated content screening (`SAFE-05`), category management. |
| Feedback | Private feedback form, schema, admin aggregate metrics, feedback job. | Server-side completion check and reliable RSVP lookup (`DATA-04`). |
| Location data | Full administrative tree and urban zones. | Village-level seed coverage, city-corporation ward nuances, `users.area_id` foreign key. |
| Email | Branded bilingual templates for auth, invite, reminder, promotion, feedback, host decision; invite/settings links are locale-aware. | Activity-specific links (`CIRC-07`), one-click unsubscribe (`NOTIF-01`), deliverability setup, reliable non-auth sending. |
| Admin queues | Counts and lists for reports, hosts, activities, circle requests; rematch resolution. | Pagination, filters, bulk actions and audit trail (`ADMIN-04`, `SAFE-07`). |
| SEO | Landing metadata with hreflang and OG image; manifest. | Sitemap, robots, canonical, per-page OG, noindex on private routes, structured data. |
| Testing | 93 unit tests; 21 Playwright cases. | Integration coverage for circle lifecycle, polls, notifications, privacy and moderation; CI execution. |

### B.3 Missing features

These are absent, not merely broken. They are listed separately so they are not mistaken for regressions.

- **Direct messaging (1:1)** — no conversations, messages, read receipts, unread counts, or realtime.
- **Connections / follow / friend requests** — no graph, acceptance flow, mutual connections, or suggested people.
- **User discovery and search** — members cannot browse or search other members; profiles are only reachable from activities, circles, reports and admin.
- **Public/private communities** — circles are system-matched and private; there is no create/join/leave community flow, membership approval, or public community directory.
- **Posts, comments, reactions** — no feed or user-generated posts outside circle chat.
- **Community discovery / recommendations** — no interest- or location-based community suggestions.
- **One-click e-mail unsubscribe** — preference links exist, but no signed unsubscribe token or preference-centre landing page.
- **Admin audit log** — no record of who suspended, approved, edited or resolved what.
- **Interest/category management** — interests are seeded; no admin CRUD.
- **Platform configuration** — no feature flags, matching schedule, limits, or announcement management.
- **Email change** — users cannot change their email or username after sign-up.
- **Data export / portability** — no download of one's data.
- **Two-factor authentication** — no TOTP/backup codes, including for admins.
- **CAPTCHA / bot defence** — rate limits only.
- **Content and image moderation** — no NSFW scanning, profanity filtering, or spam detection.
- **Legal pages** — no privacy policy or terms of service; guidelines and photo credits exist.
- **Sitemap, robots.txt, canonical/hreflang policy** beyond the landing page.
- **Monitoring, alerting, health endpoint, CI/CD, backups/retention.**

### B.4 Broken features (confirmed)

| Broken behaviour | Where | See |
| --- | --- | --- |
| Activity e-mails link to the board, not the activity | `lib/email/index.tsx` | `CIRC-07` |
| Account deletion does not recompute or notify affected circles | `lib/actions/profile.ts` | `SAFE-03` |
| Editing an activity does not notify attendees; past activities can be re-approved | `lib/actions/host.ts`, `lib/actions/admin.ts` | `DATA-01` |
| Waitlist promotion e-mail shows a raw ISO timestamp | `lib/actions/rsvp.ts` | `DATA-03` |
| Reminder e-mail sends the venue name as the address | `lib/jobs/reminders.ts` | `DATA-02` |
| Host “Completed” section includes cancelled activities | `app/[locale]/(app)/host/page.tsx` | `UX-04` |
| Locale switch drops filters/search/page | `components/features/nav/locale-switcher.tsx` | `I18N-05` |
| Error page's retry button says “Something went wrong” | `app/[locale]/error.tsx` | `UX-03` |
| Feedback can fail for the 51st RSVP | `lib/actions/feedback.ts` | `DATA-04` |

### B.5 Journey matrix

| Journey | Status | Notes |
| --- | --- | --- |
| Sign up → email OTP → onboarding → home | **Works (not re-run here)** | E2E spec exists; requires a seeded disposable DB. |
| Sign in → session persistence → sign out | **Works** | DB session, 30-day cookie, sign-out clears the client session. |
| Profile edit → avatar upload → updated profile | **Works (Cloudinary required)** | Upload E2E spec exists; uploads are disabled without all three Cloudinary credentials. |
| Discover activity → RSVP → address revealed | **Works** | Phone verification gate, capacity transaction, waitlist. |
| Match → accept → active circle → chat → vote | **Works (code path)** | Accept/decline and three-accept activation are implemented; needs a seeded integration test and pending migrations applied. |
| Notification → open notification centre → mark read | **Works** | `/notifications` exists; RBAC and mark-read actions are wired. |
| Report user/activity → admin review → action | **Partial** | Target preview, hide and resolution exist; no audit log or appeal path. |
| Admin sign-in → user management → role change | **Works** | Self-demotion/suspension is blocked. No audit log. |
| Admin rematch queue → resolve request | **Works** | Resolution action updates status and notifies the member. |
| Discover people → connect → message | **Missing** | No discovery, connections or DMs. |
| Join a community → post → react | **Missing** | No public communities, posts or reactions. |

### B.6 Route inventory (35 pages)

Marketing: `/`, `/guidelines`, `/credits`.  
Auth: `/sign-in`, `/sign-up`, `/verify`, `/forgot-password`, `/reset-password`.  
Member app: `/dashboard`, `/home`, `/activities`, `/activities/[id]`, `/circles`, `/circles/[id]`, `/notifications`, `/profile/[id]`, `/settings`, `/onboarding`, `/host`, `/host/new`, `/host/[id]`, `/host/[id]/edit`.

Admin: `/admin`, `/admin/users`, `/admin/reports`, `/admin/host-applications`, `/admin/activities`, `/admin/venues`, `/admin/locations`, `/admin/circles`, `/admin/circles/[id]`, `/admin/metrics`.  
System: `/[locale]/[...rest]`, `/access-denied`, root `/` redirect, icon and manifest routes.

**Not present:** `/messages`, `/people`, `/connections`, `/communities`, `/privacy`, `/terms`, `/sitemap.xml`, `/robots.txt`.
---

## C. Detailed Issues

### C.0 Severity summary

| Severity | Count | Meaning in this report |
| --- | --- | --- |
| Critical | 0 | Core product unusable or confirmed data loss; must be fixed before any user-facing deployment. |
| High | 7 | Serious security, privacy, integrity, broken core journey, or launch blocker. |
| Medium | 36 | Broken edge journeys, material UX/i18n/performance/ops gaps, or risks that need a planned fix. |
| Low | 13 | Polish, dead code, minor inconsistencies, documentation. |

Basis counts: **Confirmed defects** dominate the Critical/High list; **Missing** is used for product capabilities that do not exist; **Risk** is used for credible failure modes not exercised end-to-end.

---

### C.1 Critical

No open Critical issues remain. The circle lifecycle and poll vote loss findings were remediated after the audit and removed from this report.

### C.2 High

#### CIRC-07 · High · Activity e-mails link to the board instead of the activity

- **Category:** Broken journey / i18n
- **Files:** `lib/email/index.tsx:209` (promotion → `${appUrl()}/activities`), `:242` (reminder → `${appUrl()}/activities`), `:304` (feedback → `${appUrl()}/activities`); invite (`:175`) and settings footers are already locale-aware.
- **Basis:** Confirmed
- **Description:** Circle invites and notification-settings links now include the recipient's locale and the circle ID. The three activity e-mails still link to the general activities board and do not accept an `activityId`, so a reminder, waitlist promotion or feedback request cannot open the activity it refers to.
- **User impact:** Members must search the board for the activity named in the e-mail; reminders and feedback requests lose their call to action, especially for Bangla recipients who still land on the localized board but not the item.
- **Reproduction:** Trigger a waitlist promotion, reminder or feedback request with a user whose `locale = 'bn'`; inspect the href. It is `http://host/bn/activities`, not `/bn/activities/{id}`.
- **Recommended solution:** Add `activityId` to the three e-mail inputs and centralise `activityUrl(id, locale)`. Use the recipient's stored locale and the entity ID in every caller (`lib/actions/rsvp.ts`, `lib/jobs/reminders.ts`, `lib/jobs/feedback.ts`). Test both locales.
- **Acceptance criteria:** Every activity e-mail opens `/en|bn/activities/{id}`; links work when signed out (redirect to sign-in preserves the destination); both locales are covered by a test.

#### AUTH-02 · High · Production only warns when SMS is unconfigured

- **Category:** Authentication / security / reliability
- **Files:** `lib/env.ts:92-97` (warns only), `lib/sms/index.ts:16-23` (console provider throws in production), `lib/auth.ts:184-191` (delivery errors propagate)
- **Basis:** Confirmed
- **Description:** The console provider now refuses production, OTPs are no longer logged there, and `sendOTP` propagates delivery failures instead of reporting success. The remaining gap is boot-time validation: `SMS_PROVIDER=console` in production only emits a warning, so the app starts with a phone-verification gate that cannot work.
- **User impact:** A deployment without Twilio looks healthy while every phone OTP fails. Members who need the verified-phone gate for RSVP cannot complete it, and operators may miss the single startup warning. Twilio outages are still not surfaced to monitoring.
- **Reproduction:** Set `NODE_ENV=production` with `SMS_PROVIDER=console` and no Twilio credentials; the build/start succeeds with a warning, and requesting a phone code fails at send time.
- **Recommended solution:** Fail fast at startup in production when the console provider is selected (or disable and hide phone verification). Expose `smsEnabled` through the health endpoint, and alert on repeated send failures.
- **Acceptance criteria:** Production cannot boot with the console provider, or phone verification is explicitly disabled; a failed send is visible to the user and monitored; OTPs never appear in production logs.

#### SAFE-03 · High · Account deletion leaves affected circles inconsistent

- **Category:** Privacy / data lifecycle
- **Files:** `lib/actions/profile.ts:132-223` (`deleteAccount`), `lib/db/schema.ts` (`circle_members`, `circles`), `app/[locale]/(app)/settings/page.tsx`
- **Basis:** Confirmed
- **Description:** Deletion now clears `username`/`displayUsername`, removes all user uploads (public and private), cancels hosted activities, notifies attendees, hides privacy fields and deletes credentials/sessions. The remaining gap is circle state: memberships are set to `left` without recomputing the circle's status or notifying the members who stay. There is also no pre-deletion data export or documented retention policy for safety evidence.
- **User impact:** A circle can remain `active` below its minimum size, and remaining members get no explanation when someone disappears. The deletion flow still falls short of a complete “delete my data” promise because export and evidence-retention rules are undocumented.
- **Reproduction:** Delete an account that belongs to an active circle. Inspect `circle_members` (status `left`) and `circles` (status unchanged); check the remaining members' notifications (none).
- **Recommended solution:** Recompute circle status in the same transaction and notify remaining members; document a retention exception for reports/evidence; add a data-export step before deletion; cover deletion with an integration test.
- **Acceptance criteria:** No username or private upload remains outside the documented exception; affected circles are recomputed and remaining members notified; export/retention is documented; deletion is covered by a test.

#### DATA-01 · High · Activity edits are silent and past activities can be re-approved

- **Category:** Data integrity / host workflow
- **Files:** `lib/actions/host.ts` (`updateActivity`, `cancelActivity`), `lib/actions/admin.ts` (`reviewActivity`), `lib/queries/activities.ts`, `lib/db/schema.ts` (`rsvps`)
- **Basis:** Confirmed
- **Description:** Capacity can no longer be lowered below confirmed attendees, cancelling releases every RSVP and waitlist seat, and check-in only accepts `going` members. Still missing: editing an approved activity returns it to `pending` but does not notify attendees when the time, venue or capacity changes; `reviewActivity` can approve an activity whose `startsAt` is already in the past; there is no edit history.
- **User impact:** Members can hold a confirmed spot for a meetup whose time or venue silently changed, or for a date that has already passed. Hosts and admins cannot see what changed between approvals.
- **Reproduction:** Create an approved activity with going members, edit its time, and inspect notifications — none. Re-approve an activity whose start date has passed — the action succeeds.
- **Recommended solution:** Notify `going` and `waitlist` members on material edits (time, venue, capacity) before/after re-approval; reject approval when `startsAt` is in the past; record an edit history or audit entry.
- **Acceptance criteria:** Material edits notify attendees; capacity cannot fall below going; past activities cannot be approved; cancelled activities show no confirmed attendees; tests cover edit/cancel/re-approve.

#### OPS-01 · High · No error monitoring, alerting, health check or structured logging

- **Category:** Operations / production readiness
- **Files:** `app/[locale]/error.tsx` (console only), `lib/actions/action.ts:175` (console), `lib/notify.ts:39` (console), `lib/uploads/server.ts` (console warnings), no Sentry/OpenTelemetry dependency, no `/api/health`
- **Basis:** Confirmed
- **Description:** Errors are written to stdout with ad-hoc prefixes. There is no error tracker, no request/correlation ID, no alerting, no uptime check, no queue/job monitoring, and no health endpoint. Job failures are caught and logged per item, so a completely failed run can exit successfully.
- **User impact:** Production failures (matching, reminders, SMS, uploads, database saturation) would be invisible until users complain. There is no way to measure error rates or investigate a specific failed action.
- **Reproduction:** Force an action error and inspect the logs — a console line only; no event is reported anywhere. No health route appears in the build output.
- **Recommended solution:** Add Sentry (or an OpenTelemetry pipeline), capture Server Action/job errors with context and a request ID, add `/api/health` (DB + optional dependencies), emit structured job summaries, and configure alerts for error rate, job failure, and SMS/email failure.
- **Acceptance criteria:** A thrown action and a failed job both produce a tracked event with context; health endpoint reflects DB connectivity; alerts fire in a staging test.

#### LEGAL-01 · High · No privacy policy, terms of service, or sign-up consent

- **Category:** Legal / launch readiness
- **Files:** `app/[locale]/(marketing)/guidelines/page.tsx`, `credits/page.tsx`, `app/[locale]/(auth)/sign-up/page.tsx` (no consent checkbox), `messages/en.json` / `bn.json`
- **Basis:** Missing
- **Description:** The public site has community guidelines and photo credits, but no privacy policy and no terms of service. Sign-up does not ask the user to accept terms or a privacy notice, and there is no cookie notice. The product collects email, phone, gender, birth year, precise area, photos and safety reports.
- **User impact:** Launching in this state creates legal/compliance exposure and weakens user trust. Users cannot understand what is public, how long data is kept, or how to exercise deletion rights (the deletion flow exists but is undocumented).
- **Reproduction:** Visit `/en` and the footer — only guidelines/credits; open `/en/sign-up` — no consent controls.
- **Recommended solution:** Add localized Privacy Policy and Terms pages, link them in the footer and sign-up, record consent (`termsAcceptedAt`, `privacyAcceptedAt`), describe data categories, retention, sharing (Cloudinary/Resend/Twilio), safety-report handling, and deletion/export rights. Have the text reviewed for Bangladesh and, if serving diaspora, GDPR.
- **Acceptance criteria:** Both pages exist in en/bn; sign-up records consent; footer links; deletion/export rights are described and implemented.

#### DISC-01 · High · The advertised social graph — discovery, connections, DMs, communities, posts — does not exist

- **Category:** Product scope / missing features
- **Files:** route tree, `lib/db/schema.ts` (no connections/follows/conversations/posts tables), `README.md` (product framing)
- **Basis:** Missing
- **Description:** The current product is an automatic weekly matching + private circle chat + activity RSVP system. It has no user search/discovery, no connection or follow graph, no 1:1 messaging, no public/private communities that members can create or join, no posts/comments/reactions, and no community directory. Profiles are reachable only through activities, circles, reports or admin.
- **User impact:** Members cannot find people with shared interests, build connections beyond the assigned circle, or interact between meetups. For a product positioned as a social community platform, this is a major scope gap rather than a bug; the audit should not treat it as an accidental regression.
- **Reproduction:** Inspect the route inventory and schema — no such routes or tables; the navigation exposes only home/activities/circles/host/profile.
- **Recommended solution:** Make an explicit product-scope decision. If these features are in scope, deliver them as a coherent MVP (e.g. interest/location-based people discovery → connection request → accept → DM, plus member-created communities) rather than piecemeal. If they are out of scope, align the marketing, README and onboarding copy with what exists. Do not launch with copy that implies capabilities the app lacks.
- **Acceptance criteria:** Product copy and navigation match the implemented surface; any new feature has schema, authorization, privacy, moderation and tests.

---

### C.3 Medium

#### CIRC-08 · Medium · Leaving a circle can hide it from the members who stay

- **Files:** `lib/actions/circles.ts:147-183` (`leaveCircle`), `lib/queries/circles.ts:16-29`.
- **Finding:** Leaving sets the member to `left`; if fewer than three active members remain, the circle is set to `forming`. `getMyCircle` only returns `active` circles, so the remaining members immediately lose the circle from `/circles` and `/home`. No one is notified; the circle page becomes read-only.
- **Impact:** A two-person departure silently removes a functioning circle from the survivors' UI, with no explanation or next step.
- **Repro / fix:** Leave with two members remaining; check the circle list. Keep the circle visible to remaining members with a “forming/needs members” state, notify them, and trigger a re-match. Do not demote without a visible transition.

#### CIRC-09 · Medium · Polls never close and never become a meetup

- **Files:** `lib/matching/index.ts` (sets `closesAt`), `lib/actions/circles.ts:100-145` (`votePoll` rejects non-open), no closing job in `lib/jobs/`.
- **Finding:** `closesAt` is written but never read by a scheduler; no code sets `polls.status = 'closed'`; no winning option is converted into an activity or notification. A poll stays open forever.
- **Impact:** Circles can vote indefinitely; the chosen time is never operationalised; old polls accumulate and the newest poll replaces the visible one.
- **Repro / fix:** Create a poll, advance past `closesAt`, vote — it still succeeds. Add a closing job (or close inside `getCircleBundle` when expired), pick the winning option, notify members, and optionally create a draft activity. Test the tie/no-vote cases.

#### CIRC-10 · Medium · Circle chat has no pagination, realtime, edit/delete, or notification control

- **Files:** `lib/queries/circles.ts:100-120` (`limit(200)`), `lib/actions/circles.ts:49-98` (notify every active member on every message), `components/features/circles/message-thread.tsx`.
- **Finding:** A page always loads the oldest 200 messages in ascending order; older messages are inaccessible and new ones require a refresh. Every message creates an in-app notification for every other active member, with no mute/mention distinction. There is no edit/delete or read state.
- **Impact:** Busy circles lose history; members are spammed by chat notifications; the thread feels stale on mobile.
- **Repro / fix:** Post 201 messages; the first is unreachable. Add cursor pagination, a mute/mention preference, and realtime or polling; provide edit/delete with an audit trail.

#### CIRC-11 · Medium · Circle member list includes people who left or declined

- **Files:** `lib/queries/circles.ts:45-68` (members query has no status filter), `app/[locale]/(app)/circles/[id]/page.tsx:88-120`.
- **Finding:** `getCircleBundle` returns every `circle_members` row for the circle, including `left` and `declined`, and the page renders them as members. The active count is computed separately, so the heading and the grid disagree.
- **Impact:** Former members' identities remain visible to the circle; “N members” does not match the list; declined invitees are exposed.
- **Repro / fix:** Leave a circle; the member still appears in the grid. Filter the list to `active` (and, for admins, show other statuses separately). Add a membership status label where needed.

#### NOTIF-01 · Medium · No one-click unsubscribe token or List-Unsubscribe header

- **Files:** `lib/email/index.tsx` (preference footer exists), `lib/actions/profile.ts` (preferences require sign-in).
- **Finding:** Notification e-mails now link to `/settings` in the recipient's locale, but there is no signed unsubscribe token, no public preference landing page, and no `List-Unsubscribe` header. A signed-out recipient must sign in before changing preferences.
- **Impact:** Users cannot stop non-transactional mail in one click from the e-mail itself; complaint rates and deliverability suffer; several jurisdictions require an unsubscribe mechanism.
- **Repro / fix:** Inspect a reminder e-mail — the settings link exists, but no unsubscribe link/header. Add a signed, expiring token, a public preference page, and `List-Unsubscribe`/`List-Unsubscribe-Post` headers. Exempt security mail.

#### SAFE-04 · Medium · Reports accept arbitrary target IDs and cannot be re-filed after dismissal

- **Files:** `lib/actions/safety.ts:18-56`, `lib/validations/index.ts` (`reportSchema`), `components/features/shared/report-button.tsx`.
- **Finding:** The schema validates `targetType` and a numeric ID, but not that the target exists or that the reporter can see it. A member can file reports against nonexistent IDs or a message in a circle they do not belong to. The duplicate check is on reporter + target, regardless of report status, so a dismissed report cannot be filed again with new evidence.
- **Impact:** Report-queue spam and unusable records; no way to report a recurring issue after an initial dismissal.
- **Repro / fix:** Call `reportAction` with an arbitrary large `targetId`; it succeeds. Validate target existence and visibility, dedupe only open reports, and allow re-reporting after resolution.

#### SAFE-05 · Medium · No automated content, image or spam moderation

- **Files:** `lib/uploads/policy.ts` (magic bytes only), `lib/actions/uploads.ts`, `lib/actions/safety.ts`, `lib/auth.ts`.
- **Finding:** Uploads are type/size-checked but not scanned for NSFW or malware; circle messages have no profanity/spam filter; sign-up has rate limits but no CAPTCHA or device/IP reputation. Moderation is entirely reactive.
- **Impact:** A public launch is exposed to abusive images, spam and automated account creation; reports become the only defence.
- **Repro / fix:** Upload an abusive image under the size limit — accepted. Add a moderation provider/queue, hash-based spam controls, CAPTCHA on sign-up/OTP, and an escalation policy.

#### SAFE-06 · Medium · Suspension has no reason, appeal, or e-mail notification

- **Files:** `lib/actions/admin.ts:29-76` (`adminUserUpdate`), `lib/notify.ts`, `proxy.ts` (signs out suspended users), `app/[locale]/(auth)/sign-in/page.tsx` (error banner).
- **Finding:** Suspension deletes sessions and writes a generic in-app notification (“Your account was updated by an admin”) with the action as the body. No e-mail is sent, no reason is stored, and there is no appeal path. Restore is equally silent.
- **Impact:** Users are locked out without knowing why or how to respond; support load increases; safety actions are hard to defend.
- **Repro / fix:** Suspend a member; they are signed out and see a generic error. Store a reason and expiry, send a localized e-mail, add an appeal/contact route, and audit the action.

#### SAFE-07 · Medium · No admin audit log

- **Files:** `lib/db/schema.ts` (no audit table), `lib/actions/admin.ts`, admin pages.
- **Finding:** Role changes, suspensions, host approvals, report resolutions, venue edits and matching reruns are not recorded beyond the affected row's `resolvedBy`/`reviewedBy` fields.
- **Impact:** No accountability or forensic trail for moderation decisions; impossible to answer “who changed this and why”.
- **Repro / fix:** Resolve a report; only the report row changes. Add an append-only `admin_audit_log` (actor, action, target, before/after, reason, timestamp) written by every admin action, and an admin page to view it.

#### DATA-02 · Medium · Reminder/feedback jobs are N+1, use server time zone, and mislabel the address

- **Files:** `lib/jobs/reminders.ts:47` (`format` without a time zone), `:73` (`attendee.rsvp.checkedIn || row.venueAddress ? row.venueName : undefined`), `lib/jobs/feedback.ts` (per-attendee queries).
- **Finding:** For each activity the job queries attendees, then for each attendee queries notifications and sends mail — an N+1 pattern. `format()` uses the server's local time zone (usually UTC), so “10:00” is wrong for Dhaka. The address argument is the venue **name**, not the address, and the ternary precedence makes it depend on `checkedIn`/address rather than the attendee's eligibility.
- **Impact:** Wrong times in reminders, confusing e-mails, slow jobs at scale, and unnecessary database load.
- **Repro / fix:** Run reminders with `TZ=UTC` and compare the e-mail time with Asia/Dhaka. Use `formatInTimeZone(..., "Asia/Dhaka")`/`lib/dates.ts`, pass `venueAddress`, batch notification lookups, and add a job test.

#### DATA-03 · Medium · Waitlist-promotion e-mail shows a raw ISO timestamp

- **Files:** `lib/actions/rsvp.ts:160` (`when: outcome.promoted.startsAt.toISOString()`), `lib/email/index.tsx` (renders `when` directly).
- **Finding:** The promotion e-mail receives `2026-11-14T04:00:00.000Z` instead of a human-formatted Dhaka time.
- **Impact:** A user-visible, obviously broken e-mail at a high-intent moment.
- **Repro / fix:** Cancel a going RSVP with a waitlisted member; inspect the promotion e-mail. Format in the recipient's locale/time zone and add a template test.

#### DATA-04 · Medium · Feedback lookup is capped at 50 RSVPs and does not check completion

- **Files:** `lib/actions/feedback.ts:29-35`.
- **Finding:** `submitFeedback` selects `rsvps` for the activity with `limit(50)`, then searches for the caller. If the caller is the 51st row (including cancelled/waitlisted rows), the action returns “unauthorized”. It also accepts feedback for any activity the user is `going` to, regardless of status or end time.
- **Impact:** Legitimate attendees can be blocked from feedback; feedback can be submitted before the meetup, corrupting metrics.
- **Repro / fix:** Create 51 RSVPs and submit as the last one. Query the caller's RSVP directly, require `status='completed'` and `endsAt < now`, and add tests.

#### DATA-06 · Medium · Waitlist promotion races can leave a free seat unfilled

- **Files:** `lib/actions/rsvp.ts:82-101`.
- **Finding:** After locking the activity row, the job selects the oldest waitlisted RSVP without `FOR UPDATE SKIP LOCKED`, then updates it. Two concurrent cancellations can select the same waiting row; both promote the same person, while the second freed seat remains empty.
- **Impact:** Under-filling, surprising “I was promoted twice” states, and seat loss at popular activities.
- **Repro / fix:** Simulate two cancels in parallel with two waitlisted rows; only one is promoted. Select the waiting row `FOR UPDATE SKIP LOCKED`, or promote inside a serialized transaction with a re-check.

#### DATA-07 · Medium · Unbounded and capped lists; no admin pagination

- **Files:** `lib/queries/circles.ts:126-140` (`listCircles` no limit), `lib/queries/admin.ts` (`listReports` 100, `listAdminActivities` 100, `listAllVenues` 200), admin pages.
- **Finding:** Some admin lists are capped at 100/200 with no pagination, so older records are unreachable; `listCircles` loads every circle. There are no filters by status/date/role beyond a few tabs.
- **Impact:** Moderation queues become unusable as data grows; the circles page can become a large query.
- **Repro / fix:** Seed 150 reports; the 101st is inaccessible. Add cursor/offset pagination, total counts, and filters; cap `listCircles` with pagination/search.

#### DATA-08 · Medium · Migrations and lockfiles are git-ignored

- **Files:** `.gitignore` (`/drizzle`, `package-lock.json`, `bun.lock`), `scripts/apply-migration.mjs` (one-off), `package.json` (`db:generate`, `db:migrate`).
- **Finding:** The generated SQL migrations and both lockfiles are excluded from the repository. A fresh clone has no migration history and no reproducible dependency tree; `db:migrate` has nothing to apply, while `db:generate` would create a new baseline from the current schema.
- **Impact:** Production schema changes are not auditable or reproducible; two environments can drift; installs are non-deterministic. This is a serious release-engineering gap.
- **Repro / fix:** Clone the repo into a clean directory; `drizzle/` is absent and `npm ci` cannot run. Commit migrations and one lockfile, add a migration check to CI, and remove the hardcoded one-off script.

#### DATA-10 · Medium · Matching has no run lock or idempotency guard

- **Files:** `lib/matching/index.ts:33-230`, `scripts/run-matching.ts`.
- **Finding:** Two concurrent matching runs (cron overlap, manual admin rerun) can read the same pool before either commits, creating duplicate circles for the same users. There is no advisory lock, run table, or “already matched this week” guard.
- **Impact:** Duplicate invitations, split circles, and members stranded in multiple `forming` circles.
- **Repro / fix:** Run `npm run matching` twice concurrently against a seeded pool. Add a Postgres advisory lock and a `matching_runs` record with status/start/end; make the pool query exclude users already invited in the current run.

#### I18N-01 · Medium · Bangla UI renders English data names

- **Files:** `app/[locale]/(app)/activities/[id]/page.tsx:85` (`category.nameEn`), `:127` (`area.nameEn`), `app/[locale]/(app)/circles/[id]/page.tsx:130` (`row.areaName` = `nameEn`), `app/[locale]/(app)/profile/[id]/page.tsx`, admin queries selecting `nameEn`.
- **Finding:** Many queries select only `nameEn` and pages render it directly. In `/bn`, activity categories, areas and circle locations appear in English even though `nameBn` exists.
- **Impact:** The Bangla experience is visibly incomplete at the exact points where users decide whether an activity is nearby.
- **Repro / fix:** Open `/bn/activities/<id>` and a Bangla circle; observe English area/category names. Select both names and use `localizedName`/`locale === "bn"` everywhere; add a lint rule or query helper to prevent `nameEn` in localized pages.

#### I18N-02 · Medium · Hardcoded English strings in otherwise translated screens

- **Files:** `components/features/circles/create-poll-form.tsx` (“Title”, “Options”, “Option N”, Café Congo placeholder), `app/[locale]/(app)/circles/page.tsx` (“women only”), `app/[locale]/(app)/circles/[id]/page.tsx` (`" (you)"`), `app/[locale]/layout.tsx` (“Skip to content”), `components/features/nav/bottom-nav.tsx` (`aria-label="Primary"`), `app/[locale]/access-denied/page.tsx` (`title: "Access denied"`), admin raw statuses/reasons.
- **Finding:** These strings never go through the catalogs.
- **Impact:** Visible language mixing and inconsistent accessibility labels; the “fully bilingual” claim is not true in the UI.
- **Repro / fix:** Switch to `/bn` and visit these screens. Move every string into both catalogs; add a CI check that flags Latin-only literals in JSX where a translation hook exists (with an allow-list).

#### I18N-03 · Medium · Validation messages are partly English

- **Files:** `lib/validations/index.ts:143-156` (“Too short”, “Tell people a bit more”, “End time must be after start time”), `:184-195` (“A little more detail, please”, “Empty message”).
- **Finding:** Auth schemas use translation keys, but activity, host-application and message schemas use English sentences. These surface as `fieldErrors`/toasts in both locales.
- **Impact:** Bangla users see English validation errors; the action wrapper cannot translate them.
- **Repro / fix:** Submit a short activity title in `/bn`; the error is English. Replace with catalog keys and translate at the UI boundary; add a test that no Zod message is a sentence.

#### I18N-04 · Medium · Server-generated notifications and admin messages are English-only

- **Files:** `lib/matching/index.ts` (poll title, notification body), `lib/actions/admin.ts:70-76` (“Your account was updated by an admin”), `:92-100` (“Your report was reviewed”), `lib/jobs/reminders.ts`, `lib/actions/rsvp.ts`, `lib/actions/feedback.ts`.
- **Finding:** Notification titles/bodies are stored as English strings at write time, with no locale or message key. A Bangla user's bell (once it exists) and any future notification centre will show English.
- **Impact:** The most important lifecycle messages are untranslated; e-mails are localized but in-app messages are not.
- **Repro / fix:** Run matching with `bn` users and inspect `notifications`. Store a type + payload and render through the recipient's locale at read time, or store both translations. Add a notification rendering layer and tests.

#### I18N-05 · Medium · Locale switcher drops query parameters and does not persist the preference

- **Files:** `components/features/nav/locale-switcher.tsx:31`.
- **Finding:** It calls `router.replace(pathname, { locale: other })` using `usePathname()` only. Filters, search, pagination and `next` callbacks are lost. It also does not call `updateLanguage`, so the stored `users.locale` (used for e-mails) stays unchanged.
- **Impact:** Switching language on the activity board resets filters; a user who prefers Bangla can keep receiving English e-mails.
- **Repro / fix:** Apply filters, switch locale, observe the URL loses `?category=...`. Preserve `useSearchParams()` and update the stored locale (with a transition) when the user is signed in.

#### I18N-06 · Medium · Dates and times are inconsistent across time zones

- **Files:** `app/[locale]/(admin)/admin/reports/page.tsx:63` (`toISOString().slice(0,16)`), `app/[locale]/(admin)/admin/page.tsx:158` (ISO date), `app/[locale]/(admin)/admin/circles/page.tsx:60` (ISO date), `app/[locale]/(app)/host/page.tsx` (`user.locale` rather than URL locale), `app/[locale]/(app)/activities/[id]/page.tsx:49` (`user?.locale ?? "en"`), `lib/jobs/reminders.ts:47` (`format` in server TZ).
- **Finding:** Admin pages show UTC ISO slices, jobs format in the server time zone, and member pages choose language from the stored user locale rather than the URL. `NextIntlClientProvider timeZone="Asia/Dhaka"` only affects client-side formatting.
- **Impact:** Times can be off by six hours; a `/bn` page can render English dates if the profile language is `en` (and vice versa); admin audit timestamps are ambiguous.
- **Repro / fix:** Set the server `TZ` to UTC and compare an admin timestamp/reminder with Dhaka. Use `formatDate`/`formatDateTime` with the route locale and an explicit `Asia/Dhaka` zone everywhere; add tests for both locales.

#### UX-01 · Medium · Onboarding refresh restarts at step 1

- **Files:** `app/[locale]/(app)/onboarding/page.tsx`, `components/features/onboarding/onboarding-flow.tsx`.
- **Finding:** Step state lives in component state and is initialised at the first step. Data is persisted per step, but a refresh returns the user to step 1; the comment claiming the flow resumes is inaccurate. The step is not encoded in the URL, so back/forward and deep links do not work.
- **Impact:** Users who refresh or switch apps must click through completed steps again; the flow feels unreliable on mobile.
- **Repro / fix:** Complete two steps, refresh; you are back at step 1. Derive the initial step from saved data and store progress in the URL (`?step=`), with guards for skipped steps.

#### UX-02 · Medium · The phone-verification deep link is unreachable after onboarding

- **Files:** `app/[locale]/(app)/onboarding/page.tsx` (redirect when `phoneNumberVerified || onboardedAt`), `lib/session.ts` (`requireVerifiedPhone`), `components/features/activities/rsvp-button.tsx`.
- **Finding:** The onboarding page redirects an already-onboarded user to `/home` even when `?step=phone` is present. The RSVP gate sends unverified users to `/onboarding?step=phone`, which immediately redirects home; the user is not shown how to verify. The only working path is Settings.
- **Impact:** A user who tries to RSVP without a phone loops back to home with no explanation; the gate's own deep link does not work.
- **Repro / fix:** Complete onboarding without a phone, then RSVP. Allow the phone step for onboarded users (or route the gate to `/settings#phone`), show a clear explanation, and test the gate.

#### UX-03 · Medium · The error page's retry button is labelled “Something went wrong”

- **Files:** `app/[locale]/error.tsx:27` (`t("generic")`).
- **Finding:** `errors.generic` is “Something went wrong. Please try again.” and is used as the reset button label.
- **Impact:** A confusing, low-quality recovery screen at the worst possible moment.
- **Repro / fix:** Force a route error; the button reads the full error sentence. Add a dedicated `errors.retry` key (“Try again” / “আবার চেষ্টা করুন”).

#### UX-04 · Medium · Host “Completed” section contains cancelled activities

- **Files:** `app/[locale]/(app)/host/page.tsx:82-88`.
- **Finding:** The “past” bucket is `startsAt < now || status === "cancelled"`, and the section heading is `status.completed`. Cancelled activities are therefore listed under “Completed”.
- **Impact:** Hosts cannot distinguish a successful meetup from a cancellation; attendance metrics look wrong.
- **Repro / fix:** Cancel an upcoming activity; it moves to “Completed”. Use separate headings for completed and cancelled, or show the actual status badge in the row.

#### UX-05 · Medium · Forms ignore `fieldErrors` and show only a generic toast

- **Files:** `components/features/host/activity-form.tsx`, `components/features/profile/profile-form.tsx`, `components/features/circles/create-poll-form.tsx`, `lib/hooks/use-error-message.ts`.
- **Finding:** Most client forms call `errorMessage(result.error)` and never read `result.fieldErrors`. Users see “Please check the highlighted fields” with nothing highlighted.
- **Impact:** Repeated failed submissions, especially on long activity/host forms; poor mobile experience.
- **Repro / fix:** Submit an invalid activity; only a toast appears. Surface `fieldErrors` next to inputs with `aria-describedby`, focus the first invalid field, and keep the toast for form-level errors.

#### UX-06 · Medium · Location search is not keyboard-accessible

- **Files:** `components/features/locations/location-picker.tsx:230-300`.
- **Finding:** Results are a `role="listbox"` of `role="option"` elements that contain buttons, with no arrow-key handling or `aria-activedescendant`; the dropdown does not close on outside click/Escape. Async results can arrive out of order and overwrite a newer query.
- **Impact:** Keyboard and screen-reader users cannot reliably pick a location; mobile users see an overlapping list.
- **Repro / fix:** Tab to the search, type “Gulshan”, press ArrowDown/Enter — no selection. Implement a proper combobox pattern (or use an accessible primitive), cancel stale requests, and close on blur/Escape.

#### ADMIN-03 · Medium · Circles are read-only and there is no category or platform configuration management

- **Files:** `app/[locale]/(admin)/admin/circles/*`, `lib/queries/circles.ts` (`listCircles`, `getAdminCircleDetail`), `lib/actions/admin.ts` (no circle actions), `lib/db/schema.ts` (`interests`, no settings/flags table).
- **Finding:** Admins can inspect circles but cannot create, edit, archive, activate, add/remove members, or resolve a stuck circle. Interests/categories are seed-only. There is no platform settings/feature-flag surface.
- **Impact:** Operations depend on direct SQL; the broken lifecycle cannot be repaired from the panel; categories cannot evolve without a migration.
- **Repro / fix:** Open a circle detail; only read views exist. Add circle operations (activate/archive/rematch/member move), interest CRUD, and a typed settings table with an admin form.

#### ADMIN-04 · Medium · Admin lists lack pagination, sorting and useful filters

- **Files:** admin pages for users, reports, activities, host applications, circles, venues.
- **Finding:** Lists are fixed-size queries with at most a status tab; there is no page navigation, date range, search by email/username, or sort control. Older records are unreachable (see DATA-07).
- **Impact:** Moderation does not scale past a few dozen rows; investigating a specific user or report is slow.
- **Repro / fix:** Seed 150 reports/users; only the first page is visible. Add URL-driven pagination/filters, preserve state, and show totals.

#### PERF-01 · Medium · Every protected request performs session + user queries in the proxy

- **Files:** `proxy.ts:49-57`, `lib/auth.ts`, `lib/session.ts`.
- **Finding:** `proxy` calls `auth.api.getSession` and then selects the full user row for every non-public navigation, including prefetches. The page/layout then queries the user again (per-request memoisation helps only within the render, not the proxy).
- **Impact:** Added latency and database load on every page view; worse on cold starts; the proxy bundle includes the auth/database stack.
- **Repro / fix:** Measure TTFB with and without the user query; instrument query counts. Cache the role/status/onboarding fields in the session claims or a short-lived cache, select only needed columns, and avoid the user query on routes that do not need it.

#### PERF-02 · Medium · Bundle and image strategy are unmeasured

- **Files:** `package.json` (framer-motion, many Radix packages), `components/motion/*`, `next.config.ts` (wildcard remote patterns), avatars/upload previews (`<img>`).
- **Finding:** Framer Motion is used across marketing and app shells; there is no bundle analyzer or performance budget. Remote image patterns allow any path on Unsplash/Cloudinary. Some previews use raw `<img>` and avatars lack explicit dimensions/sizes.
- **Impact:** Unknown mobile bundle weight and LCP; possible layout shift; no regression guard.
- **Repro / fix:** Run `@next/bundle-analyzer` and Lighthouse on a mid-range mobile profile. Set budgets, lazy-load below-the-fold motion, restrict remote paths to the actual Cloudinary folder/Unsplash params, and use `next/image` with sizes for avatars.

#### PERF-03 · Medium · No caching strategy beyond one landing-page cache

- **Files:** `next.config.ts` (`cacheComponents: false`), `lib/queries/landing.ts` (`unstable_cache` 10 min/1 h), all dynamic pages.
- **Finding:** Every page queries Postgres on every request; only landing stats/coverage are cached, with no tag-based invalidation. Conversely, the cache can be stale for up to 10 minutes after a change.
- **Impact:** Higher database load and latency at scale; stale marketing numbers after seeding.
- **Repro / fix:** Load-test the activity board/home. Introduce explicit caching for reference data (interests, locations) and public aggregates with tags, keep user-specific pages dynamic, and document invalidation.

#### SEO-01 · Medium · No sitemap or robots.txt

- **Files:** `app/` (no `sitemap.ts`/`robots.ts`), build route table.
- **Finding:** Neither route exists. Search engines receive no canonical URL set and no crawl policy for the bilingual app.
- **Impact:** Poor indexing of the public marketing/guidelines/credits pages; duplicate en/bn URLs; private routes are not explicitly disallowed.
- **Repro / fix:** Request `/sitemap.xml` and `/robots.txt` → 404. Add `app/sitemap.ts` with en/bn alternates and public routes, and `app/robots.ts` disallowing `/admin`, `/api`, and member-only paths.

#### SEO-02 · Medium · Metadata is incomplete outside the landing page

- **Files:** `app/[locale]/layout.tsx` (global title/description, no `metadataBase`), `app/[locale]/(marketing)/page.tsx` (hreflang + OG), activity/profile pages (title only), `app/[locale]/access-denied/page.tsx` (hardcoded English title).
- **Finding:** No `metadataBase`, canonical URLs, per-activity/profile OG images/descriptions, JSON-LD, or `robots: { index: false }` on private/app pages. The global description is English in both locales.
- **Impact:** Weak sharing previews, duplicate-content signals, and private pages that are technically crawlable.
- **Repro / fix:** Inspect `<head>` on `/en`, `/bn`, an activity and `/en/settings`. Add `metadataBase`, canonical/alternates per page, localized descriptions, dynamic OG for activities, noindex for app/admin/auth, and JSON-LD for public activities.

#### SEC-03 · Medium · Dependency audit reports nine advisories; build tooling is in production dependencies

- **Files:** `package.json`, lockfile (not committed).
- **Finding:** `npm audit --omit=dev` reports 9 vulnerabilities (4 low, 5 moderate), including `drizzle-kit`→`@esbuild-kit/*`→`esbuild`, `fast-uri`, `html-to-text`/`deepmerge`, and `@react-email/*`. `drizzle-kit` and `pg` are listed in `dependencies`, so a production install includes build/CLI tooling. No automated dependency update policy or audit gate exists.
- **Impact:** Larger production surface and image size; known advisories in tooling; no guard against future high/critical issues.
- **Repro / fix:** `npm audit --omit=dev`. Move `drizzle-kit` to `devDependencies`, remove unused runtime packages, upgrade `fast-uri`/`drizzle-kit` where compatible, and add an audit/renovate gate in CI.

#### SEC-04 · Medium · `BETTER_AUTH_SECRET` accepts 16 characters

- **Files:** `lib/env.ts:29` (`z.string().min(16)`), `README.md` / `.env.example` guidance.
- **Finding:** The minimum is 16 characters, with no entropy check; production deployments can use a guessable passphrase.
- **Impact:** Session/token forgery risk if the secret is weak; rotating it signs out all users, and there is no documented rotation procedure.
- **Repro / fix:** Set a 16-character dictionary secret; validation passes. Require at least 32 random characters (or base64 32 bytes), document rotation, and fail production boot on a known placeholder.

#### OPS-02 · Medium · No CI, deploy configuration, or reproducible release process

- **Files:** repository root (no `.github/workflows`, Dockerfile, `vercel.json`, `fly.toml`), `package.json` scripts, `docs/operations.md`.
- **Finding:** Checks are manual; there is no pipeline running typecheck/lint/unit/E2E/build, no image/build artifact, no migration step, and no documented rollback. Lockfiles and migrations are ignored (DATA-08).
- **Impact:** Regressions reach production; environments drift; onboarding a second developer or host is guesswork.
- **Repro / fix:** Inspect the repo root. Add CI (typecheck, lint, unit, build; E2E on a disposable DB), commit migrations/lockfile, define a deploy target and health check, and document rollback/restore.

#### OPS-03 · Medium · Rate limiting is missing on several state-changing actions

- **Files:** `lib/actions/circles.ts` (`createPoll`, `votePoll`, `leaveCircle`), `lib/actions/safety.ts` (`blockAction`, `unblockAction`), `lib/actions/profile.ts` (`updateProfile`, `updateNotificationPrefs`), `lib/actions/admin.ts` (admin-only), `lib/actions/locations.ts` (read actions).
- **Finding:** Sensitive actions have limits, but poll creation/voting, blocking, profile updates and location search do not. A member can create unlimited polls or hammer search.
- **Impact:** Notification/chat spam, poll flooding, scraping of the 6k location tree, and unnecessary write load.
- **Repro / fix:** Call `createPoll` repeatedly; no limit. Add per-user fixed-window limits with sensible keys, and a read limit for location search. Cover the wrapper with tests.

#### OPS-04 · Medium · E-mail configuration fails silently for non-auth mail

- **Files:** `lib/env.ts` (`RESEND_API_KEY` optional, `emailEnabled` false without it), `lib/email/index.tsx:38-56`.
- **Finding:** Without `RESEND_API_KEY`, auth-code sending throws (sign-up fails loudly), but every other e-mail returns silently in production. There is no startup warning/fail-fast for a production deployment that intends to send mail, and no SPF/DKIM/domain verification guidance.
- **Impact:** Invitations, reminders, promotions and host decisions are silently dropped in a misconfigured production environment.
- **Repro / fix:** Boot with `NODE_ENV=production` and no key; trigger a reminder — no error, no mail. Fail fast (or surface a prominent admin health warning), document DNS/domain setup, and monitor send failures.

#### OPS-05 · Medium · No backup, retention, or restore documentation

- **Files:** `docs/operations.md`, `scripts/`, no backup job.
- **Finding:** There is no documented database backup schedule, point-in-time recovery, upload retention, report/evidence retention, or restore drill. Account deletion now removes identity and uploads, but the retention exception for safety evidence and the circle-consistency step are undocumented.
- **Impact:** Data loss or an inability to restore after an incident; unclear retention obligations for safety evidence.
- **Repro / fix:** Search the docs/scripts for backup/restore — none. Define RPO/RTO, automate backups and restore tests, document retention per table/asset class, and implement deletion/expiry jobs.

#### TEST-01 · Medium · Critical paths lack integration coverage and E2E was not executed in this audit

- **Files:** `tests/unit/*` (8 files, 93 tests), `tests/e2e/*` (4 files, 21 cases), `vitest.config.ts`, `playwright.config.ts`.
- **Finding:** Unit tests cover the pure matcher, waitlist rules, action wrapper, auth validation, geo, RBAC, upload policy and profile privacy. There are no tests for circle activation/acceptance, poll voting, notification preferences/centre, attendee privacy, deletion circle state, blocking side effects, feedback, jobs or admin queues. The Playwright suite covers smoke/auth/profile/RSVP/admin/messages/uploads, but requires a seeded disposable DB and Cloudinary stand-in; it was not run in this audit. No coverage threshold or CI gate exists.
- **Impact:** The fixed lifecycle, poll and privacy paths can regress without detection; the core journey still relies on manual verification.
- **Repro / fix:** `npm run test` passes; `npm run test:e2e` requires the environment described in the README. Add integration tests for the lifecycle/poll/prefs/privacy paths, run E2E in CI with a disposable DB, and enforce coverage on the pure/logic modules.

---

### C.4 Low

| ID | Area | File(s) | Finding | Impact / recommended fix |
| --- | --- | --- | --- | --- |
| LOW-01 | Dead code | `lib/queries/circles.ts` (`getActiveCircleMemberIds`), `lib/uploads/server.ts` (`isOwnCloudinaryUrl`), `lib/geo/*` (`withinLocation`), `lib/session.ts` (`requireVerifiedPhone`) | Exports with zero call sites (verified by search). `markAllReadAction` and `listNotifications` are now used by the notification centre. | Confusing API surface; remove or wire the remaining exports. |
| LOW-02 | Dependencies | `package.json` | `@radix-ui/react-tooltip` has no imports; `pg` is listed alongside the runtime `postgres` driver; `drizzle-kit` is a production dependency. | Larger install/image; remove unused packages and move tooling to devDependencies. |
| LOW-03 | Accessibility / i18n | `app/[locale]/layout.tsx` (“Skip to content”), `components/features/nav/bottom-nav.tsx` (`aria-label="Primary"`) | English-only accessibility strings. | Screen readers in Bangla hear English; move to catalogs. |
| LOW-04 | SEO | `app/[locale]/access-denied/page.tsx` | `metadata.title = "Access denied"` hardcoded; no localized metadata. | Inconsistent language in the tab/title; generate localized metadata. |
| LOW-05 | Branding debt | `app/[locale]/layout.tsx` (`bondhu-theme`), `package.json` (`bondhu-circle`) | Legacy repo name appears in the theme storage key and package name. | Confusing for new contributors; rename with a migration read of the old key if desired. |
| LOW-06 | Number formatting | `app/[locale]/(admin)/admin/page.tsx:137` | Counts use `toLocaleString("en-US")` even in Bangla. | Bangla digits are inconsistent with the rest of the UI; use the active locale. |
| LOW-07 | UX | `components/features/circles/circle-request-form.tsx` | A duplicate request throws `ActionError("circles.request.submitted")`, so the success sentence appears as an error toast. | Confusing feedback; add a dedicated “already requested” key and hide/disable the form while a request is open. |
| LOW-08 | Notifications | `components/features/nav/notification-bell.tsx` | Unread count is server-rendered only; it does not update until navigation/refresh. | Stale badge; add lightweight polling or update after mark-read/mutations. |
| LOW-09 | Mobile | `app/[locale]/layout.tsx` (`viewport`), `components/features/nav/bottom-nav.tsx` | `env(safe-area-inset-bottom)` is used, but the viewport does not set `viewportFit: "cover"`. | On iOS the inset may be 0; add `viewportFit: "cover"` and test on a notched device. |
| LOW-10 | Admin safety | `components/features/admin/report-actions.tsx`, user/host/venue actions | Destructive/irreversible actions generally lack a confirmation dialog. | Misclicks can suspend, reject or resolve; add confirmations for destructive actions. |
| LOW-11 | Validation | `lib/validations/index.ts:275` (`mapUrl` max length only) | Arbitrary strings, including non-http schemes, can be stored as a venue map URL. | Admin-only, but validate `https://` and render with `rel="noreferrer noopener"` (already present); reject `javascript:`. |
| LOW-12 | Analytics / consent | Repository | No analytics, consent banner, or privacy-respecting product metrics. | Cannot measure activation or retention; decide on a consent-aware analytics plan before launch. |
| LOW-13 | Loading UX | `app/[locale]/loading.tsx` | A single generic card-grid skeleton is used for every route, including admin tables and forms. | Layout shift/confusing loading; add route-shaped skeletons for the busiest pages. |

---

## D. Technical Assessment

### D.1 Architecture

**Shape.** The application is a single Next.js 16 App Router deployment with four route groups: marketing (public), auth, member app, and admin. `proxy.ts` (Next 16's renamed middleware) handles `/api/auth/*` forwarding, locale detection, session/suspension checks, and RBAC before the route renders. Route-group layouts repeat the authorization check with `requireRole` / `requireAdmin` / `requireHost`, and every mutation goes through `createAction` with an `authorize` policy. Reads live in `lib/queries/*`; pure rules live in `lib/matching/core.ts`, `lib/rsvp/waitlist.ts`, `lib/rbac.ts`, `lib/geo/*`, `lib/uploads/policy.ts` and the Zod schemas.

**Strengths.** The separation between actions, queries and pure logic is real, not aspirational. The action wrapper centralises session → suspension → role/phone gate → rate limit → validation → handler → revalidation, which removes a large class of per-action mistakes. The `ActionError("namespace.key")` convention keeps user-visible errors translatable and prevents stack traces leaking to clients. Upload ownership and private-asset handling are unusually mature.

**Weaknesses.**
- **The domain lifecycle is only partly modelled.** `forming`, `invited`, `active`, `declined`, `left`, `pending`, `approved`, `cancelled`, `completed` still exist as strings; accept/decline and three-accept activation now live in `lib/actions/circles.ts`, but no shared state machine owns transitions. This is the root of the remaining leave/activation edge cases (`CIRC-08`, `CIRC-09`, `DATA-01`).
- **The proxy is heavy.** It imports Better Auth and the database client, performs a session lookup and a full user-row query on every non-public navigation, and then hands off to next-intl. It also defaults unknown paths to `public`, so a newly added protected route is only safe if someone remembers to classify it in `ruleFor`.
- **Read queries are page-shaped, not reusable.** `getCircleBundle`, `getActivityDetail` and `getAdminCircleDetail` return large object graphs and run several sequential queries. This is acceptable at current scale but makes caching, pagination and reuse harder.
- **Route groups are invisible in the URL**, so the policy is keyed on the first path segment. That is workable, but it couples `lib/rbac.ts` to URL structure and makes nested resources (e.g. `/admin/circles/[id]`) depend on the first segment only.
- **No API boundary.** Server Actions are the only application API, which is a defensible choice for this product, but it means there is no versioned contract, no webhook surface, and no place for a future mobile client. `/api/auth/*` is the only HTTP API.

### D.2 Database and data integrity

**Schema.** PostgreSQL with Drizzle. Tables cover users, sessions, accounts, verifications, rate limits, locations, interests, preferences, availability, circles, members, messages, polls/options/votes, uploads, venues, activities, RSVPs, host applications, reports, blocks, feedback, notifications and user settings. Soft deletes exist on users, circles, venues and uploads. Statuses are text columns validated in Zod, not PostgreSQL enums, so invalid values are prevented only by application code.

**Strengths.**
- Useful indexes on the hot paths: activities `(status, starts_at)`, RSVPs `(activity_id)`/`(user_id)`, circle messages `(circle_id, created_at)`, reports `(status)`, notifications `(user_id, created_at)`, areas `(level)`, `(parent_id)` and a GIN index on `ancestor_ids`.
- Unique indexes for the important join tables: circle membership, poll votes per user, RSVPs per activity/user, host applications per user, blocks per pair, feedback per user/activity, usernames.
- RSVP capacity is protected by a transaction and `FOR UPDATE` on the activity row. This is the strongest integrity mechanism in the codebase.
- Soft deletes are respected in the main reads (`users.deleted_at`, `circles.deleted_at`), and the location tree is idempotently upserted.

**Gaps.**
- **Email and phone uniqueness are enforced** with `uniqueIndex` on `lower(email)` and `phone_number`; `verifications.identifier` is indexed. The migration is generated but still pending.
- **No committed migrations** (`DATA-08`); the schema is the source of truth only if someone runs `db:generate` and applies the result. The one-off `scripts/apply-migration.mjs` is not a migration system.
- **No state-machine constraints** on circles/activities/RSVPs. The database will happily store an `active` circle with zero active members, a `going` RSVP for a cancelled activity, or a `forming` circle forever.
- **No audit table** for admin actions (`SAFE-07`).
- **No matching-run table/lock** (`DATA-10`), so reruns are not idempotent.
- **`users.area_id` has no foreign key**, so a deleted/moved area leaves a dangling ID. This is documented as intentional in the project docs, but it weakens location integrity.
- **Feedback uniqueness** includes a nullable `activity_id`, so multiple rows with `NULL` activity are allowed; not currently harmful, but not a clean constraint.

**Transaction coverage.** RSVP join/cancel, matching materialisation per group, poll creation, feedback insert and account deletion use transactions. Blocking no longer mutates circle membership; the circle leave/demotion path (`CIRC-08`) still mutates multiple rows without a transaction.

### D.3 Backend and API

**Validation.** Zod schemas are shared by client and server, which is the right pattern. Auth schemas are strong (username/password rules, BD phone regex, 6-digit OTP). Activity/host/message schemas contain English sentences (`I18N-03`), and a few fields validate length but not semantics (e.g. `mapUrl`).

**Authorization.** Each Server Action declares an `authorize` policy (`user`, `verified-phone`, `host`, `admin`); hosted activity operations additionally check `hostId`/admin; uploads resolve ownership; the public profile excludes contact details; the venue address is gated on a confirmed RSVP. I did not find a working IDOR in profile, activity address, circle chat or admin reads. Attendee lists and profiles are now scoped by visibility, so the main authorization weakness is **default-public route classification**, not broken ownership checks.

**Error handling.** `createAction` returns `{ ok, data } | { ok, error, fieldErrors? }`, translates known errors, logs unhandled ones, and never throws raw errors at the client. This is consistent and good. Forms frequently ignore `fieldErrors` (`UX-05`). Background jobs catch per-item errors and log, so a failed run can still exit successfully.

**Pagination.** The activity board paginates; admin lists are capped, not paginated (`DATA-07`); circle chat is capped at 200 with no cursor; notifications are limited; location search is bounded. At scale, the admin panel and chat are the first problems.

**N+1 and query shape.** `getActivityDetail` runs four sequential queries (activity, RSVP, going count, waitlist count); `getCircleBundle` runs six (members, activities, poll, options, votes, messages); `getAdminCircleDetail` runs members/upcoming/poll/chat plus options. These are constant per page, not classic N+1, but they add latency. The reminder and feedback jobs are true N+1: one notification query per attendee, one mail per attendee, one attendee query per activity (`DATA-02`).

**API surface.** No REST/GraphQL app API; Server Actions are the contract. `/api/auth/*` is forwarded by the proxy. This is coherent for the current web-only product. There are no webhooks, no idempotency keys for external callers, and no API documentation.

### D.4 Authentication and authorization

**Authentication.** Better Auth provides email/password, username, email OTP, phone OTP and password reset. Passwords require length and character variety; usernames have a validator; sessions are database-backed with a 30-day expiry, daily refresh, and a 1-day “fresh” window for sensitive operations. Cookies are httpOnly, SameSite=Lax, and Secure in production. Suspended/deleted users are signed out by the proxy.

**Authorization.** `lib/rbac.ts` is the single policy: sections (`public`, `member`, `host`, `admin`), roles, permissions, `homePathFor`, `decideAccess`. Route-group layouts call the server guards; actions call `authorize`; the admin panel is unreachable to members even by direct URL (the E2E spec asserts a 403). Admin self-demotion/suspension is blocked, which protects the last admin from a common footgun.

**Gaps.**
- Email and phone uniqueness are database-enforced, but migrations are still pending.
- Production only warns when SMS is unconfigured (`AUTH-02`).
- No email change flow; username is also immutable.
- No 2FA or step-up authentication for admins.
- No CAPTCHA/bot defence on sign-up/OTP.
- The route policy defaults to public (`proxy.ts`), so a forgotten `ruleFor` entry exposes a new page.
- The proxy's matcher skips paths containing a dot, so a future dotted admin route would bypass RBAC; currently no such route exists.
- No admin audit trail.

### D.5 Security

**What is good.**
- Parameterized Drizzle queries and `sql` templates; no string-concatenated user input. `%`/`_` are escaped in location search.
- React escaping for all user-generated text; no `dangerouslySetInnerHTML` except the constant theme script.
- Upload policy checks magic bytes, size and MIME; filenames are cleaned; public/private purposes are separated; private assets are served through short-lived signed URLs.
- Server Actions inherit Next.js same-origin protections; Better Auth has `trustedOrigins` configured from the app URL.
- Rate limits on sign-in/sign-up/OTP, RSVP, messages, reports, feedback, host applications and uploads.
- Secrets are server-only; no `NEXT_PUBLIC_` secret prefixes. `.env` files are git-ignored.
- Soft deletes and ownership checks limit accidental data exposure.

**What is missing or weak.**
- Production only warns when SMS is unconfigured; delivery failures are visible but not monitored (`AUTH-02`).
- `BETTER_AUTH_SECRET` minimum of 16 (`SEC-04`).
- No 2FA for admins, no audit log, no CAPTCHA.
- Nine dependency advisories, mostly low/moderate, with build tooling in production dependencies (`SEC-03`).
- No content-security review of `mapUrl` (admin-only, `LOW-11`).
- No documented incident response, key rotation, or secret-management process.
- No penetration test or threat model; the product handles sensitive gender/location/safety data.

**Verdict:** the security fundamentals are better than typical MVPs; headers, unique email and OTP handling are fixed. Launch-blocking hardening (audit log, 2FA, SMS fail-fast, monitoring) is still incomplete.

### D.6 Privacy and safety

**Protected by design:** email/phone are never selected by `getPublicProfile`; the exact venue address and map link are withheld until `going`; report evidence and host documents are private Cloudinary assets; reports are visible only to admins; blocks hide messages in the thread and exclude pairs from matching.

**Remaining exposure:**
- Account deletion removes memberships without recomputing or notifying the affected circle (`SAFE-03`).
- No audit log, no appeal path, no reason for suspension (`SAFE-06`, `SAFE-07`).
- No data export or documented retention policy.
- No privacy policy/terms (`LEGAL-01`).
- No automated content/image moderation or spam defence (`SAFE-05`).

For a product explicitly aimed at safety and loneliness, these are not optional polish; they determine whether vulnerable users can trust the platform.

### D.7 Performance

**Measured:** production build compiles in ~5 s; TypeScript checking ~12 s; 6 static pages; all application routes are dynamic (`ƒ`). No Lighthouse/Core Web Vitals, load test, or bundle analysis was performed, so no performance claims can be made beyond “it builds”.

**Likely bottlenecks:**
- `proxy.ts` session + user query per protected request.
- Sequential queries in detail pages.
- N+1 reminder/feedback jobs.
- Unbounded `listCircles` and fixed-cap admin lists.
- Framer Motion across the app shell and marketing page; no budget.
- Remote images with wildcard patterns and some raw `<img>` previews.
- Every page dynamic; only landing aggregates cached (10 min/1 h).
- Matching loads all blocks globally and creates circles one transaction at a time.

**Recommended measurement plan:** instrument query counts and TTFB, run Lighthouse mobile on `/en`, `/en/activities`, `/en/home`, `/en/circles/[id]`, add `@next/bundle-analyzer`, and load-test the activity board/home with 100–500 concurrent users before launch.

### D.8 UI/UX and accessibility

**Strengths.** A coherent design system (Radix + CVA + Tailwind v4), a restrained teal/amber palette, responsive grids, a mobile bottom nav with 56 px targets and safe-area padding, empty states on the main lists, loading skeleton, localized 404/403 pages, toast feedback, and reduced-motion-aware animations. Forms use shared primitives and labels. The landing page is content-rich and localized.

**Gaps.**
- Remaining broken journeys: activity e-mails land on the board, activity edits are silent, and the error page's retry label is wrong.
- Data names and several strings break the Bangla experience (`I18N-01`, `I18N-02`).
- Validation errors are not attached to fields (`UX-05`).
- Location search is not keyboard-accessible (`UX-06`).
- Admin tables lack pagination and mobile density work.
- One generic skeleton for all routes (`LOW-13`); safe-area inset without `viewportFit: cover` (`LOW-09`).
- No automated accessibility testing (axe) or contrast audit.
- The app has no documented offline/PWA behaviour beyond the manifest.

### D.9 Internationalization

**Healthy:** 975 keys in both `en.json` and `bn.json`, full parity; the Bangla catalog is genuinely translated (a scan for mostly-Latin values found only the email placeholder). Locale-prefixed routing is consistent; `Link`/`router` come from `@/i18n/navigation`; the client provider sets `Asia/Dhaka`.

**Leaky:** data names (`nameEn`), hardcoded UI strings, English Zod messages, English notification titles/bodies, activity e-mails that open the board instead of the item, UTC ISO admin dates, server-TZ job formatting, and a locale switcher that drops query state and does not persist the preference. The catalogs are not the problem; the problem is code that bypasses them.

### D.10 SEO and metadata

Only the landing page has a complete metadata treatment (localized title/description, en/bn alternates, OG image). The global layout provides a title template and description but no `metadataBase`, canonical policy, or localized description. There is no sitemap, robots.txt, per-activity/profile OG, JSON-LD, or noindex on private routes. The manifest and icons are present. For a public social product, this is a launch-phase gap, not a code-quality issue.

### D.11 Testing

**Unit:** 8 files, 93 tests, all passing. Coverage includes the matching core, waitlist rules, the action wrapper, auth validation, the geo tree, RBAC, upload policy and profile privacy. These are exactly the right pure domains to test.

**E2E:** 21 cases across smoke (11), admin (3), messages (2) and uploads (5). They exercise real auth/OTP, onboarding, RSVP/address reveal, password reset, admin 403s, report-button labels and upload ownership, against a real dev server and seeded Postgres. They were **not run in this audit** because no seeded disposable database or Cloudinary stand-in was confirmed. Playwright starts `npm run dev` itself and reuses an existing server; uploads require the Cloudinary stand-in env.

**Missing:** tests for the circle lifecycle, poll voting, notification preferences/centre, attendee privacy, deletion circle state, feedback, jobs, admin queues, and any component/accessibility tests. No coverage threshold, no CI gate.

### D.12 Operations and production readiness

- No monitoring/alerting/health check (`OPS-01`).
- No CI/CD or deploy configuration (`OPS-02`).
- Migrations and lockfiles ignored (`DATA-08`), so builds are not reproducible.
- No backup/restore/retention plan (`OPS-05`).
- E-mail silently disabled for non-auth mail without a key (`OPS-04`); SMS only warns at boot when unconfigured (`AUTH-02`).
- No queue for jobs; cron setup is documented only at a high level; matching has no lock (`DATA-10`).
- No feature flags, maintenance mode, or admin announcement mechanism.
- Environment validation is a strength: required variables fail at import with readable messages, and Cloudinary warns when only the API key is set.
- The proxy's Node-runtime dependency (Postgres/Better Auth) means the deployment target must support Node middleware; an edge-only host would not work. This is not documented.

### D.13 Third-party integrations

| Integration | State | Assessment |
| --- | --- | --- |
| Cloudinary | Signed upload, policy, ownership, private assets, signed downloads | Strong design. Requires all three credentials; uploads disabled with a clear UI message otherwise. No malware/NSFW scanning. |
| Resend | Bilingual React Email templates | Good templates; optional key; non-auth mail silently skipped in production; no one-click unsubscribe/List-Unsubscribe; activity links lack entity IDs. |
| Twilio / SMS | Pluggable provider; production-safe console guard | Console refuses production and errors propagate; still no boot-time fail-fast, delivery reports, or monitoring; BD-only number validation excludes diaspora. |
| Unsplash | Landing/activity imagery with credits page | External dependency and wildcard image allow-list; no local fallback if the CDN is blocked. |
| PostgreSQL | Drizzle + postgres-js | Sound, but no committed migrations or backup plan. |
| Better Auth | Email/password, username, emailOTP, phoneNumber, nextCookies | Well configured; email/phone uniqueness is enforced; SMS boot validation is the remaining weak point. |

### D.14 Code quality and maintainability

**Strengths:** strict TypeScript, consistent naming, small pure modules, documented “why” comments in critical places, a coherent error model, and a clear repository map in `AGENTS.md`. The code reads like it was written by someone who cares about the domain.

**Debt:** dead exports (`LOW-01`), unused dependencies (`LOW-02`), a 590-line landing page, page-shaped queries, duplicated date formatting, English strings in schemas, and a few “temporary” scripts. None of this is unusual; the main risk is that circle/activity lifecycle transitions are still strings checked ad hoc and therefore invisible to the type system.

---

## E. Prioritized Action Plan

### E.1 Phase 1 — Remaining launch blockers (target: 1–2 weeks)

**Goal:** close the legal, observability and release-engineering gaps that still block a public launch.

1. **Legal minimum** (`LEGAL-01`): localized privacy policy and terms, sign-up consent, footer links, documented retention/deletion. *2–3 days including review.*
2. **Observability minimum** (`OPS-01`): Sentry/OTel, request IDs, health endpoint, job summaries, alerts. *1–2 days.*
3. **Reproducible release** (`OPS-02`, `DATA-08`): CI running typecheck/lint/unit/build, committed migrations and lockfile, deploy configuration, rollback notes. *2–3 days.*
4. **Activity e-mail deep links** (`CIRC-07`): pass `activityId` and recipient locale, centralise `activityUrl`, test both locales. *0.5–1 day.*
5. **SMS fail-fast** (`AUTH-02`): refuse production boot with the console provider (or disable the phone gate) and expose provider health. *0.5 day.*
6. **Deletion circle consistency** (`SAFE-03`): recompute affected circles, notify remaining members, document evidence retention and data export. *1–2 days.*
7. **Activity edit integrity** (`DATA-01`): notify attendees on material edits, block approval of past activities, record edit history. *1–2 days.*
8. **Admin audit log** (`SAFE-07`): record moderation, suspension, host decisions and rematch resolutions. *1–2 days.*

**Exit criteria:** privacy/terms live with recorded consent; errors tracked and health check green; CI builds and deploys reproducibly; activity e-mails open the activity; production cannot boot with unusable SMS; deletion leaves circles consistent; edits notify attendees; moderation actions are auditable.

### E.2 Phase 2 — Remaining core and edge correctness (target: 2–4 weeks)

1. **Notification/email polish** (`CIRC-07`, `NOTIF-01`, `DATA-02`, `DATA-03`): activity links, one-click unsubscribe, correct reminder address, formatted promotion time. *2–3 days.*
2. **Circle consistency** (`CIRC-08`–`CIRC-11`): leave/recompute behaviour, poll closing, chat pagination/delete, member-list filtering. *4–6 days.*
3. **Feedback integrity** (`DATA-04`): direct RSVP lookup, completed-only, host-driven completion. *1–2 days.*
4. **Waitlist/matching races** (`DATA-06`, `DATA-10`): row lock/`SKIP LOCKED`, matching run lock, idempotency. *2–3 days.*
5. **Jobs correctness** (`DATA-02`, `DATA-07`): batch queries, Asia/Dhaka formatting, bounded lists. *2–3 days.*
6. **Admin queues** (`ADMIN-04`): pagination, sorting and filters for users, reports, activities, hosts, circles and venues. *3–4 days.*
7. **i18n cleanup** (`I18N-01`–`06`): `nameBn`, hardcoded strings, validation keys, notification rendering, locale switcher, Dhaka dates. *4–6 days.*
8. **Form/onboarding UX** (`UX-01`–`UX-06`): retry label, field errors, focus management, host completed/cancelled, onboarding resume, phone deep link, keyboard search. *2–3 days.*
9. **Report validation and suspension workflow** (`SAFE-04`, `SAFE-06`): target ownership checks, re-file rules, reason/appeal and notification. *1–2 days.*

### E.3 Phase 3 — Product scope and launch features (target: 4–8 weeks, scope-dependent)

These are product decisions, not bug fixes. Do not launch marketing that promises them until they exist.

1. **User discovery and connections**: search by area/interest, suggested people (privacy-aware), request → accept/decline, mutual connections.
2. **Messaging**: 1:1 conversations with block/report, unread counts, pagination, and a clear realtime-or-refresh model.
3. **Communities**: member-created public/private communities, join/leave/approval, directory, moderation roles. Decide whether this replaces or complements automatic circles.
4. **Posts/comments/reactions** if the product is a feed; otherwise explicitly position APON as circles-first.
5. **Admin audit log, interest CRUD, platform settings/flags, appeal workflow** (`SAFE-07`, `ADMIN-03`).
6. **Email change, data export, 2FA for admins, CAPTCHA** (`AUTH` gaps).
7. **Content/image moderation and spam defence** (`SAFE-05`).
8. **SEO and legal completeness**: sitemap, robots, canonical/hreflang policy, per-page OG, noindex, JSON-LD; cookie notice if analytics is added.
9. **Operations maturity**: backups/restore drills, retention jobs, runbooks, on-call/alerting.

### E.4 Phase 4 — UI/UX, performance and accessibility (target: 2–4 weeks)

- Run Lighthouse mobile and a bundle analysis; set budgets; lazy-load motion; restrict remote image patterns; add `sizes` to avatars.
- Add route-shaped skeletons and optimistic UI for chat/RSVP where safe.
- Accessibility: axe in CI, combobox keyboard support (`UX-06`), form error association, contrast audit, 12 px minimum labels, focus order, screen-reader pass in Bangla.
- Mobile QA on a notched device, a low-end Android, and slow 3G; verify safe areas, tap targets, table overflow.
- Admin density/pagination and destructive-action confirmations (`LOW-10`).
- Design consistency pass on empty/error/loading states.

### E.5 Phase 5 — Technical debt and long-term improvements

- Remove dead exports and unused dependencies (`LOW-01`, `LOW-02`).
- Introduce a shared activity/circle state machine module and use it in actions, queries and admin.
- Consolidate date/locale helpers so no page calls `toLocaleString`/`toISOString` for display.
- Add query instrumentation and slow-query logging; consider caching reference data.
- Raise `BETTER_AUTH_SECRET` requirements, document rotation, add secret scanning to CI.
- Split the landing page into sections; extract shared e-mail link builders.
- Add coverage thresholds for pure modules and a dependency-update policy.
- Write ADRs for the circle lifecycle, privacy model, notification matrix and moderation policy.

### E.6 Sequencing and rough effort

| Phase | Scope | Effort (dev-days) | Dependency |
| --- | --- | --- | --- |
| 1 | Remaining launch blockers | 9–15 | None; start immediately |
| 2 | Core/edge correctness | 20–30 | Phase 1 migrations and release path |
| 3 | Product-scope launch features | 40–80 | Product scope decision |
| 4 | UX/perf/a11y | 15–25 | Phases 1–2 |
| 5 | Debt/ops maturity | Ongoing (~20%) | Continuous |

A single experienced full-stack developer should expect **4–7 weeks** to reach a defensible closed beta (Phases 1–2), and **3–5 months** to a public launch with discovery/connections/messaging if those remain in scope.

### E.7 Launch gate checklist

- [x] No open Critical issue from this report.
- [x] Circle: match → accept → active → post/vote/leave covered by the code path (integration test still needed).
- [x] Poll: two users' votes coexist; changing a vote replaces only that user's rows.
- [x] Notification: bell → centre → mark read/all; preferences suppress both channels.
- [ ] Notification: activity e-mails deep-link to the activity; one-click unsubscribe works.
- [x] Privacy: non-attendee sees only counts; blocked profiles hidden; gender/age/area visibility configurable.
- [ ] Moderation: a reported message can be hidden/removed with an audit entry; suspension has a reason and appeal path.
- [x] Auth: duplicate email fails at the DB; phone OTP failures are visible; no OTPs in production logs.
- [ ] Auth: production cannot boot with console SMS; admin 2FA.
- [ ] Data: migrations and lockfile committed; backup/restore drill passed; account deletion leaves circles consistent.
- [x] Security: headers/CSP/HSTS live; hardcoded credential removed.
- [ ] Security: dependency audit has no high/critical; secrets scanned.
- [ ] Legal: privacy policy and terms in en/bn; sign-up consent recorded.
- [ ] Ops: error tracking, health check, alerts, CI running typecheck/lint/unit/E2E/build.
- [ ] Performance: Lighthouse mobile budgets met on `/en`, `/en/activities`, `/en/home`; load test at expected launch concurrency.
- [ ] Accessibility: axe critical/serious issues zero on the main journeys; keyboard-only pass in en/bn.
- [ ] SEO: sitemap, robots, canonical/hreflang, noindex on private routes, per-page OG.

---

## F. Verification Log and Limitations

### F.1 Checks actually run

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Passed (exit 0). |
| Lint | `npm run lint` | Passed (exit 0). |
| Unit tests | `npm run test` | Passed: 8 files, 93 tests. |
| Production build | `npm run build` | Passed (exit 0); compiled in ~5 s; TypeScript ~12 s; 6 static pages; all app routes dynamic. |
| i18n parity | Catalog comparison | 975 keys in each of `en.json` / `bn.json`; zero missing. |
| Bangla translation scan | Script over `bn.json` | Only one mostly-Latin value (an email placeholder); the catalog is genuinely translated. |
| Dependency audit | `npm audit --omit=dev` | 9 vulnerabilities: 4 low, 5 moderate; no high/critical. |
| Route inventory | `find app -name page.tsx` + build output | 35 pages, including `/notifications`; still no `/privacy`, `/terms`, `/sitemap.xml`, `/robots.txt`. |
| Dead-export search | `grep` for call sites | `markAllReadAction` and `listNotifications` are now used by the notification centre; other unused exports remain (`LOW-01`). |
| Credential scan | Inspected `scripts/apply-migration.mjs` | No hardcoded credential; uses `DATABASE_URL`. |
| Security headers | Inspected `next.config.ts` | CSP, HSTS, frame, nosniff, referrer and permissions headers are present. |

### F.2 What could not be tested

- **Playwright E2E** (`npm run test:e2e`): requires a seeded disposable PostgreSQL database and, for uploads, a Cloudinary stand-in. No verified disposable environment was available; the suite was not executed. The 21 specs are therefore coverage evidence, not a pass result.
- **Real e-mail delivery** (Resend), **real SMS** (Twilio), and **real Cloudinary** uploads/private downloads: no credentials were provided and none should be committed. The code paths were reviewed statically.
- **Production deployment, TLS, DNS, CDN, backups, and Core Web Vitals**: no hosting target or monitoring was available. No performance numbers are claimed.
- **Two-account privacy tests** (attendee list, blocking, profile visibility) were traced in code, not exercised in a browser.
- **Concurrent sign-up / waitlist / matching races**: reasoned from code; not load-tested.
- **Browser/device matrix** (iOS safe areas, low-end Android, Bangla screen readers): not executed.

### F.3 Assumptions

- The product described in the audit brief (connections, communities, posts, messaging, user discovery) is the intended scope; where it is absent, it is reported as missing rather than as a broken existing feature.
- A public launch is the target; closed-beta severity may differ.
- The `forming → active` transition is implemented in application code; the pending migrations still need to be applied before the lifecycle can run against a real database.
- `npm run db:seed` was not run; it truncates every table and requires a disposable database.
- The remediation pass changed application code and schema. This report was updated after those changes; resolved issue cards were removed rather than left as historical findings.

### F.4 How to reproduce the audit

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --omit=dev

# After preparing a disposable seeded DB + Cloudinary stand-in:
npm run test:e2e
```

For the remaining issues, inspect the cited files and run the steps in each card. The activity-email gap is visible in `lib/email/index.tsx`; the deletion circle gap in `lib/actions/profile.ts`; and the missing legal/ops surface from the route table and `package.json`.

---

## Appendix A — Key file map

| Concern | Files |
| --- | --- |
| Routing / proxy / RBAC | `proxy.ts`, `lib/rbac.ts`, `i18n/routing.ts`, `app/[locale]/**/layout.tsx` |
| Auth | `lib/auth.ts`, `lib/auth-client.ts`, `lib/session.ts`, `lib/validations/auth.ts`, `app/[locale]/(auth)/**` |
| Actions / validation | `lib/actions/*.ts`, `lib/actions/action.ts`, `lib/validations/index.ts` |
| Queries | `lib/queries/*.ts` |
| Schema / DB | `lib/db/schema.ts`, `lib/db/index.ts`, `drizzle/` (git-ignored), `scripts/migrate.ts` |
| Matching / circles | `lib/matching/{core,index}.ts`, `lib/actions/circles.ts`, `lib/queries/circles.ts`, `app/[locale]/(app)/circles/**` |
| Activities / RSVP | `lib/actions/{host,rsvp,feedback}.ts`, `lib/rsvp/waitlist.ts`, `lib/queries/activities.ts`, `app/[locale]/(app)/activities/**`, `host/**` |
| Locations | `lib/geo/*`, `lib/queries/locations.ts`, `lib/actions/locations*.ts`, `components/features/locations/**`, `scripts/sync-locations.ts` |
| Uploads | `lib/uploads/{policy,server,signature}.ts`, `lib/actions/uploads.ts`, `components/features/uploads/**` |
| Notifications / e-mail | `lib/notify.ts`, `lib/queries/notifications.ts`, `lib/actions/notifications.ts`, `lib/email/**` |
| Safety / admin | `lib/actions/{safety,admin}.ts`, `lib/queries/{safety,admin}.ts`, `app/[locale]/(admin)/**` |
| UI system | `components/ui/**`, `components/features/**`, `components/motion/**`, `app/globals.css` |
| i18n | `messages/{en,bn}.json`, `i18n/**`, `app/[locale]/layout.tsx` |
| Jobs | `lib/jobs/{reminders,feedback}.ts`, `lib/matching/index.ts`, `scripts/run-*.ts`, `scripts/send-*.ts`, `scripts/request-*.ts` |
| Tests | `tests/unit/**`, `tests/e2e/**`, `vitest.config.ts`, `playwright.config.ts` |
| Docs | `README.md`, `AGENTS.md`, `docs/{architecture,data-model,development,operations}.md` |

## Appendix B — Issue index

**Critical:** none.

**High:** CIRC-07, AUTH-02, SAFE-03, DATA-01, OPS-01, LEGAL-01, DISC-01.

**Medium:** CIRC-08–11, NOTIF-01, SAFE-04–07, DATA-02–04, DATA-06–08, DATA-10, I18N-01–06, UX-01–06, ADMIN-03–04, PERF-01–03, SEO-01–02, SEC-03–04, OPS-02–05, TEST-01.

**Low:** LOW-01–13.

---

*End of report. Updated after the first remediation pass; resolved issue cards were removed and the remaining findings reflect the current code. Code changes are uncommitted and migrations 0008–0010 are still pending.*
