# APON documentation

APON matches people across Bangladesh into small weekly circles of 4–6 and gives
them hosted, real-world activities to meet at. The product is bilingual
(English / বাংলা) and built as a single Next.js 16 application.

Start with the document that matches your task:

| Document                             | Read it when                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md) | You need the request lifecycle, route map, authorization model, or how matching, RSVP, uploads and i18n fit together |
| [data-model.md](./data-model.md)     | You are changing `lib/db/schema.ts`, writing a query, or need the meaning of a status value                          |
| [development.md](./development.md)   | You are setting up the project, adding a page/action/query, or running tests                                         |
| [operations.md](./operations.md)     | You are deploying, scheduling jobs, seeding an environment, or reviewing security                                    |

`AGENTS.md` at the repo root is the short, binding rulebook for coding agents (and
a good orientation for humans). These docs explain the same system in depth.

## Mental model

```
Browser ──► proxy.ts ──► route group layout ──► page (Server Component)
                │                                   │
                │                                   ├─ lib/queries/*  ──► Drizzle ──► PostgreSQL
                │                                   └─ client form ──► Server Action
                │                                                          │
                ├─ /api/auth/* ──► Better Auth                             ├─ createAction
                └─ next-intl locale routing                                 │   (session, role,
                                                                            │    rate limit, Zod)
                              Cloudinary ◄── uploadFile                     │
                              Brevo      ◄── lib/email                      └─ revalidate
                              Twilio     ◄── lib/sms
```

Two facts explain most of the codebase:

1. **Everything is server-first.** Pages read through `lib/queries`, writes go
   through wrapped Server Actions, and authorization is re-checked at every layer.
2. **Everything is locale-aware and BCP-47 bilingual.** A cookie selects English
   or Bangla without changing the URL, and every user-facing string lives in `messages/`.

## Glossary

| Term                | Meaning                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Circle**          | A group of 4–6 people in one matching zone, created by the weekly matching run. Has chat, a time poll and meetups.                                        |
| **Zone**            | The matching cluster a location belongs to (e.g. `dhanmondi`, `gulshan`, `dhaka-savar`). Children inherit their parent's zone.                            |
| **Area**            | Any node in the Bangladesh location tree (division → district → city corporation/upazila → thana/union/ward → area/village).                              |
| **Onboarding**      | The four-step setup (interests, area, availability, preferences + guidelines). Completing it stamps `users.onboarded_at`, which unlocks the member panel. |
| **Verified phone**  | A phone number attached through Better Auth's phone OTP plugin. Required to RSVP or join a circle, not to browse.                                         |
| **Host**            | A member approved to create and manage activities. Role `host` or `admin`.                                                                                |
| **Activity**        | A scheduled meetup at a venue, created by a host and approved by an admin. Has capacity, cost and optional women-only flag.                               |
| **RSVP / waitlist** | A seat (`going`) or a queue position (`waitlist`) for an activity. Cancelling promotes the longest-waiting member.                                        |
| **Upload**          | A Cloudinary asset recorded in `uploads`, owned by the member who uploaded it and scoped to one purpose.                                                  |
| **Member panel**    | The signed-in app under `(app)`: home, activities, circles, profile, settings, host tools.                                                                |
| **Admin panel**     | The separate `/admin` shell for moderation, reference data and metrics.                                                                                   |
