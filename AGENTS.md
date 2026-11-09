<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — working in APON

APON (repo `bondhu-circle`) is a bilingual (English / বাংলা) web app that matches
people anywhere in Bangladesh into small weekly circles of 4–6 and gives them
hosted, real-world activities to meet at. It is a Next.js 16 App Router
application with PostgreSQL, Better Auth, Drizzle, Cloudinary and Resend.

- **Product and setup:** `README.md`
- **How the system fits together:** `docs/architecture.md`
- **Tables, statuses and invariants:** `docs/data-model.md`
- **Setup, recipes and testing:** `docs/development.md`
- **Jobs, deploy and security:** `docs/operations.md`

Read the architecture doc before a cross-cutting change. Read the data-model doc
before touching `lib/db/schema.ts` or any query.

## Commands

Use npm (the README's flow). Both lockfiles are gitignored in this checkout; do
not switch package managers or commit them.

| Task                     | Command                                                     |
| ------------------------ | ----------------------------------------------------------- |
| Dev server               | `npm run dev` → http://localhost:3000/en                    |
| Typecheck                | `npm run typecheck` (`tsc --noEmit`)                        |
| Lint                     | `npm run lint` (ESLint 9 flat config)                       |
| Format                   | `npm run format` (Prettier + Tailwind plugin)               |
| Unit tests               | `npm run test` (Vitest, `tests/unit/**`)                    |
| E2E tests                | `npm run test:e2e` (Playwright, real dev server + DB)       |
| Generate migration       | `npm run db:generate`                                       |
| Apply migrations         | `npm run db:migrate`                                        |
| Push schema (local only) | `npm run db:push`                                           |
| Seed demo data           | `npm run db:seed` (destructive: truncates the schema)       |
| Load location tree       | `npm run geo:sync` (idempotent upsert)                      |
| Rebuild geo dataset      | `npm run geo:build` (from `lib/geo/data/bd-admin.json`)     |
| Jobs                     | `npm run matching`, `npm run reminders`, `npm run feedback` |
| Production build         | `npm run build` then `npm run start`                        |

Node scripts that import anything under `lib/` must run with
`node --conditions=react-server --import tsx …` because those modules import
`server-only`. The package scripts already do this; copy the pattern for new
scripts.

## Repository map

```
app/
  layout.tsx                     pass-through root
  page.tsx                      → /en
  [locale]/layout.tsx           <html>/<body>, fonts, next-intl, Toaster, UploadsProvider
  [locale]/(marketing)/         /, /guidelines, /credits — public
  [locale]/(auth)/              /sign-in, /sign-up, /verify, /forgot-password, /reset-password
  [locale]/(app)/               member panel: /home, /activities, /circles, /profile,
                                /settings, /onboarding, /host (tools under /host/:id)
  [locale]/(admin)/admin/       admin panel: users, reports, hosts, activities, venues,
                                locations, circles, metrics
  [locale]/forbidden.tsx        403 page used by forbidden() (authInterrupts)
components/
  ui/                           shadcn-style primitives (Radix + CVA + cn)
  features/<domain>/            forms, cards, lists, pickers, uploads, nav
  brand/, motion/
lib/
  actions/                      Server Actions + createAction wrapper
  queries/                      read-only Drizzle queries (server components)
  validations/                  Zod schemas shared by client + server
  db/schema.ts                  entire schema and relations
  matching/{core,index}.ts      pure matcher + DB materialisation
  rsvp/waitlist.ts              pure capacity/waitlist rules
  uploads/{policy,server,signature}.ts
  geo/                          Bangladesh location tree + sync
  jobs/                         reminders + feedback jobs
  email/, sms/, cloudinary.ts   outbound integrations
  auth.ts, auth-client.ts, session.ts, rbac.ts, env.ts, rate-limit.ts, notify.ts
i18n/                           routing (en/bn, always prefixed) + navigation helpers
messages/{en,bn}.json           translation catalogs (21 namespaces, keep in sync)
proxy.ts                        Next 16 proxy: /api/auth forwarding, RBAC, next-intl
drizzle/                        generated SQL migrations (gitignored in this checkout)
scripts/                        migrate, seed, geo, jobs, icons
tests/unit/                     Vitest (pure logic)
tests/e2e/                      Playwright (seeded DB, real OTPs)
```

## Non-negotiable rules

1. **Authorization is layered and `lib/rbac.ts` is the only policy.**
   `proxy.ts` redirects / returns 403 first, route-group layouts call
   `requireRole` / `requirePermission` / `requireAdmin` / `requireHost`, and every
   Server Action declares `authorize`. Do not hard-code role checks in pages.
   Layout checks are authoritative — the proxy is the cheap first line.

2. **Every mutation is a Server Action built with `createAction`.**
   `lib/actions/*.ts` start with `"use server"` and `import "server-only"`.
   The wrapper owns session → suspension → role/phone gate → Postgres rate limit →
   Zod parse → handler → revalidation, and returns
   `{ ok: true, data } | { ok: false, error, fieldErrors? }`.
   Never throw raw errors at the client: throw `ActionError("namespace.key")`.
   Do not add ad-hoc Server Actions or `/api/*` routes for app features —
   `/api/auth/*` is the only API surface and `proxy.ts` forwards it to Better Auth.

3. **Reads go in `lib/queries/*`.** Server Components call these directly; they
   may use `cache()` for per-request memoisation. Never query the database from a
   client component.

4. **Pure logic stays pure.** `lib/matching/core.ts`, `lib/rsvp/waitlist.ts`,
   `lib/uploads/policy.ts`, `lib/geo/levels.ts`, `lib/rbac.ts` and
   `lib/validations/*` must not import `server-only`, `db`, or framework modules —
   they are tested directly and some run in the browser.

5. **Validate twice, on one schema.** Add or change rules in
   `lib/validations/index.ts` (or `auth.ts`) and reuse them in the client form and
   in the action. The server check is the one that counts.

6. **All user-facing text is translated.** Add every string to both
   `messages/en.json` and `messages/bn.json` under an existing namespace. Error
   keys returned by actions are translation keys, not sentences. Use `Link` /
   `redirect` / `usePathname` / `useRouter` from `@/i18n/navigation`, never
   `next/link` or `next/navigation`, so the `/en` or `/bn` prefix survives.

7. **Database changes are schema-first.** Edit `lib/db/schema.ts`, run
   `npm run db:generate`, inspect the SQL, then `npm run db:migrate`. Do not
   hand-write migration files or edit already-applied ones. Never run `db:seed`
   outside a disposable local database (it truncates every table).

8. **Uploads never bypass the policy.** Files go through `uploadFile`
   (`lib/actions/uploads.ts`), are typed by magic bytes, and are saved to
   `uploads`. A form value is only accepted through `resolveOwnedImage` /
   `resolveOwnedAttachment` (same owner, same purpose). Private assets
   (`report_evidence`, `host_document`) are `authenticated` on Cloudinary and are
   only reachable through short-lived `privateDownloadUrl` links.

9. **Server-only by default.** Anything importing `lib/env`, `lib/db`,
   `lib/auth`, `lib/session`, `lib/notify`, `lib/rate-limit` or `lib/email` needs
   `import "server-only"` at the top and must not be imported by a client
   component. Secrets never get a `NEXT_PUBLIC_` prefix.

10. **Respect soft deletes.** `users`, `circles`, `venues` and `uploads` use
    `deletedAt`. Filter `is null` in reads; never hard-delete history that other
    rows reference.

## Conventions

- **TypeScript:** strict, `noEmit`, bundler resolution, `@/*` → repo root.
- **Formatting:** Prettier — double quotes, semicolons, trailing commas,
  `printWidth` 90, 2 spaces, Tailwind class sorting.
- **Naming:** camelCase TS properties ↔ snake_case SQL columns; tables plural;
  route folders kebab-case; components PascalCase; query functions
  `listX` / `getX` / `assertX`.
- **Statuses are `text` columns**, validated by Zod and narrowed in code — there
  are no PostgreSQL enums. Check `docs/data-model.md` before adding a value.
- **Times:** stored as `timestamptz`; the UI renders in `Asia/Dhaka`
  (`NextIntlClientProvider timeZone`). Use `lib/dates.ts` helpers for formatting
  and form values — do not call `toLocaleString` directly.
- **UI:** compose `components/ui` primitives, keep forms in
  `components/features/<domain>`, use `sonner` toasts for action errors, and
  honour the teal `#0f766e` / amber `#fbbf24` palette and the
  `bondhu-theme` localStorage key.
- **Comments** explain _why_ (a rule, a race, a security decision), not _what_.

## Verification before you finish

Run the checks that cover what you changed; do not report a check you did not run.

1. `npm run typecheck` — always for TS/TSX changes.
2. `npm run lint` — for new components, hooks or imports.
3. `npm run test` — when you touch matching, waitlist, RBAC, geo, validations or
   the action wrapper (these are exactly what the unit suite covers).
4. `npm run test:e2e` — only for changes to auth, RBAC, onboarding, RSVP or
   uploads that need the real stack. It requires a seeded disposable database and
   starts `npm run dev` itself. Upload specs also need the local Cloudinary
   stand-in env described in `README.md`.
5. A UI change you did not look at is unverified — say so rather than claiming it
   renders correctly.

## Recipes (short form)

- **New page:** add it under the right route group, resolve the locale, call the
  matching `require*` guard, read through a `lib/queries` function, and add the
  nav entry plus translations. New protected paths must also be classified in
  `ruleFor` (`lib/rbac.ts`).
- **New action:** Zod schema → `createAction({ schema, authorize, rateLimit,
revalidate/tags, handler })` → `ActionError` for user-visible failures → call
  it from a client form via `useActionState`. Keep the explicit
  `(input, { user }: ActionContext)` annotation so `TResult` stays inferred.
- **New query:** `import "server-only"`, select only the columns the page needs,
  filter soft-deleted rows, and index any new filter column.
- **New translation:** add the key to both catalogs; use `getTranslations` in
  server components and `useTranslations` in client components.
- **New upload purpose:** extend `UPLOAD_PURPOSES`, its policy, the `uploads.purpose`
  docs and the tests in `tests/unit/uploads.test.ts`.
- **New location level:** update `LOCATION_LEVELS`, `CHILD_LEVELS`, the builder
  and `tests/unit/geo.test.ts`.
- **New job:** put idempotent logic in `lib/jobs/`, add a thin `scripts/*.ts`
  runner, and document its cron in `docs/operations.md`.

## Gotchas

- `proxy.ts` is the Next 16 middleware. There is no `middleware.ts`, and the
  matcher deliberately skips files and `_next` assets but keeps `/api/auth`.
- Every URL is locale-prefixed (`localePrefix: "always"`). `/` redirects to `/en`;
  `app/[locale]/layout.tsx` owns `<html>`/`<body>`.
- `cacheComponents` is off: pages render dynamically and read live data. Do not
  add `use cache` or `force-static` without checking the whole route.
- `forbidden()` works because `experimental.authInterrupts` is on; members hitting
  admin/host pages must get a real 403, not a silent redirect.
- `process.env` is validated once in `lib/env.ts`; a missing variable fails at
  import time with a readable message. Scripts load `.env` themselves.
- Better Auth stores OTPs plain in development/test so Playwright can read
  `verifications`; production hashes them. Never log codes in a production path.
- Without `RESEND_API_KEY`, development only logs the email event; the code is
  in the `verifications` table. Production requires the key.
- Cloudinary needs all three credentials (or `CLOUDINARY_URL`); with only the API
  key, uploads are disabled and the UI says so.
- `host_applications_pending_unique` is unique on `user_id` alone: one
  application row per member, not one pending row.
- `users.area_id` has no foreign key, and `users.email` has no database unique
  constraint (only `username` is unique). Do not assume either in raw SQL.
- Matching creates circles with status `forming`, but `getMyCircle` and every
  circle action require `active`; no code path promotes `forming → active` today.
  Treat this as a known gap before building on the circle lifecycle.
- `scripts/apply-migration.mjs` is a one-off with a hardcoded local connection
  string. Do not run it against any shared database, and do not use it as a
  migration mechanism.
- `.env.example` starts with a stray `[TEMPLATE]` line; drop it when copying to
  `.env`.
- Do not read, print, or commit `.env` values. Do not add secrets to the repo.

## Done means

The requested change is complete, its affected checks pass, both locales are
updated, authorization and ownership were considered, and any limitation is
stated plainly. Do not add unrequested features, dependencies, or refactors.
