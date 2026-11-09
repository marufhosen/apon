# Data model

All tables live in `lib/db/schema.ts`. Conventions:

- camelCase TypeScript properties ↔ snake_case SQL columns; tables are plural.
- Status columns are `text`, not PostgreSQL enums. Values are documented here and
  validated in `lib/validations/`.
- Timestamps are `timestamptz` (`created_at` / `updated_at` where meaningful).
- Soft deletes use `deleted_at`; reads must filter `is null`.
- `users`, `sessions`, `accounts`, `verifications` and `rate_limits` mirror Better
  Auth's core schema (through the Drizzle adapter) with extra profile columns.

## Relationship overview

```
areas (self-referencing tree) ──┬── users.area_id        (no FK)
                                ├── venues.area_id
                                └── activities.area_id

users ──┬── user_interests ── interests ── activities.category_interest_id
        ├── availability, preferences, user_settings
        ├── sessions, accounts
        ├── circle_members ── circles ──┬── circle_messages
        │                               ├── polls ── poll_options ── poll_votes
        │                               └── activities.circle_id
        ├── rsvps ── activities ── venues
        ├── host_applications
        ├── reports, blocks, feedback, notifications
        └── uploads
```

## Identity and profile

### `users`

| Column                                                 | Notes                                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (text, PK)                                        | Better Auth id                                                                                                                                |
| `name`, `email`, `email_verified`, `image`             | core auth. `email` has **no DB unique constraint**; Better Auth de-duplicates in application code, so a race can in principle create two rows |
| `username` (unique, lower-case), `display_username`    | username plugin                                                                                                                               |
| `phone_number`, `phone_number_verified`                | phone plugin                                                                                                                                  |
| `gender`, `birth_year`, `area_id`, `bio`, `avatar_url` | profile                                                                                                                                       |
| `role`                                                 | `member` \| `host` \| `admin` (default `member`)                                                                                              |
| `locale`                                               | `en` \| `bn` (default `en`)                                                                                                                   |
| `status`                                               | `active` \| `suspended`                                                                                                                       |
| `onboarded_at`                                         | non-null unlocks the member panel                                                                                                             |
| `guidelines_accepted_at`                               | stamped during onboarding                                                                                                                     |
| `deleted_at`                                           | soft delete                                                                                                                                   |

Indexes: `area_id`, `status`, `phone_number`. **`area_id` has no foreign key** —
validate it with `assertSelectableLocation` before saving. **`email` is not
unique** at the database level, unlike `username`; do not assume a constraint is
there when writing raw SQL.

### `sessions`, `accounts`, `verifications`, `rate_limits`

- `sessions`: database-backed sessions (`expires_at`, ip, user agent) with
  `on delete cascade` from `users`. Deleting rows force-signs a member out.
- `accounts`: credential rows hold the scrypt `password` hash; provider columns
  exist for future social providers.
- `verifications`: OTP rows. Value format is `<code>` or `<code>:<attempts>`.
  Plain in development/test, hashed in production.
- `rate_limits`: Better Auth's DB limiter (`key` PK, `count`, `last_request`).
  App-level buckets share the table with an `app:` key prefix.

## Reference data

### `areas` — the Bangladesh location tree

One adjacency-list tree of ~5,924 rows:

```
division → district → city_corporation → thana → area
                    │                 └─ ward → area
                    └─ upazila → union → village
                              └─ area
```

| Column                                   | Notes                                                       |
| ---------------------------------------- | ----------------------------------------------------------- |
| `slug` (unique)                          | Stable key used by seeding and `geo:sync`                   |
| `name_en`, `name_bn`                     | Localized names                                             |
| `level`                                  | One of `LOCATION_LEVELS` (`lib/geo/levels.ts`)              |
| `parent_id`                              | Self FK, `on delete restrict`                               |
| `ancestor_ids` (int[])                   | Root-first ancestors; GIN-indexed for "everything inside X" |
| `code`                                   | Source id from the BBS-derived dataset                      |
| `lat`, `lng`                             | Optional coordinates                                        |
| `zone`, `zone_label_en`, `zone_label_bn` | Matching cluster, inherited by children                     |
| `is_active`                              | Hidden from pickers when false                              |

`CHILD_LEVELS` defines which levels may nest under which; `SELECTABLE_LEVELS`
defines what a member may save as their home (not a division).

`npm run geo:sync` upserts by slug and never deletes admin-added villages or
renumbers existing ids.

### `interests`

20 seeded interests (`slug` unique, `name_en`, `name_bn`, `icon`). Activities use
one as their category; members pick 3–8 during onboarding.

## Profile extras

| Table            | Key                             | Notes                                                                                      |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `user_interests` | unique `(user_id, interest_id)` | Replaced wholesale on save                                                                 |
| `availability`   | PK `(user_id, weekday, slot)`   | `weekday` 0=Sun…6=Sat; `slot` morning/afternoon/evening                                    |
| `preferences`    | PK `user_id`                    | `group_size` small/medium, `women_only`, `mode` offline/online/both, `language` bn/en/both |
| `user_settings`  | PK `user_id`                    | Email/in-app notification switches                                                         |

`preferences` is one row per user. Matching treats a missing row as the defaults
(small, mixed, both, both).

## Circles

### `circles`

| Column                     | Notes                                           |
| -------------------------- | ----------------------------------------------- |
| `name`, `zone`             | Zone drives the generated name and matching     |
| `status`                   | `forming` \| `active` \| `archived`             |
| `women_only`               | Inherited from the matched group                |
| `created_by`               | `system` for matching runs, otherwise a user id |
| `matched_at`, `deleted_at` |                                                 |

Indexes: `status`, `zone`.

### `circle_members`

Unique `(circle_id, user_id)`. `role` is `member` \| `host`; `status` is
`invited` \| `active` \| `left` \| `declined`, with `joined_at` / `left_at`.
"Currently in a circle" means status in (`invited`, `active`) on a non-deleted,
active circle — this is also the matching exclusion rule.

### `circle_messages`, `circle_requests`

- `circle_messages`: `circle_id`, `user_id`, `body` (≤800), `hidden_at` for
  moderation. Indexed by `(circle_id, created_at)`.
- `circle_requests`: a member's private "rematch me" request with an optional
  reason and `status` `open` \| `handled`.

### `polls`, `poll_options`, `poll_votes`

A poll belongs to a circle (`open` \| `closed`, optional `closes_at`). Options
carry a label and optional start/end. Votes are unique per
`(poll_id, user_id)` — one choice per member per poll. The circle page shows the
latest poll only.

## Venues and activities

### `venues`

`name`, `area_id` (FK), `address`, `map_url`, optional `image_url`, `type`
(`cafe` \| `park` \| `sports` \| `coworking` \| `other`), `is_public`, `approved`,
`deleted_at`. Hosts may only book `approved` and `is_public` venues.

### `activities`

| Column                 | Notes                                                 |
| ---------------------- | ----------------------------------------------------- |
| `host_id` (FK)         | Owner of the activity                                 |
| `circle_id`            | Optional circle meetup                                |
| `title`, `description` | 6–120 / 20–3000 chars in the form                     |
| `category_interest_id` | Optional category                                     |
| `venue_id`, `area_id`  | Area is denormalized from the venue for filtering     |
| `starts_at`, `ends_at` | `timestamptz`                                         |
| `capacity`             | 2–60 in the form; default 12                          |
| `cost_bdt`             | Integer taka, 0 = free                                |
| `women_only`           | Female members only                                   |
| `status`               | `pending` \| `approved` \| `cancelled` \| `completed` |
| `cancellation_reason`  | Set on rejection/cancel                               |

Indexes: `starts_at`, `(status, starts_at)`, `area_id`, `venue_id`, `host_id`.
New activities start `pending` and become visible only when `approved`.

### `rsvps`

Unique `(activity_id, user_id)`. `status` is `going` \| `waitlist` \|
`cancelled`; `checked_in` marks attendance at a completed meetup.

Invariants (enforced in `lib/rsvp/waitlist.ts` + a `FOR UPDATE` transaction):

- `going` count never exceeds `capacity`.
- A member who is already `going` stays `going` on repeated joins.
- Cancelling promotes the oldest `waitlist` row.
- Only `going` rows count toward capacity and attendance.

## Hosts and moderation

| Table               | Status values                         | Notes                                                                                                                                                                                                              |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host_applications` | `pending` \| `approved` \| `rejected` | `motivation` (≥30), optional `experience` and private `attachment_upload_id`; reviewer columns. Approval promotes the user to `host`.                                                                              |
| `reports`           | `open` \| `actioned` \| `dismissed`   | `target_type` user/activity/message, `target_id` stored as text, reason enum, optional private evidence, resolution note/reviewer/time.                                                                            |
| `blocks`            | —                                     | Unique `(blocker_id, blocked_id)`; excludes pairs from matching and hides mutual content where checked.                                                                                                            |
| `feedback`          | —                                     | Unique `(user_id, activity_id)`: comfort 1–5, `want_to_meet_again`, `made_connection`, optional note.                                                                                                              |
| `notifications`     | `read_at`                             | `type` is one of `circle_invite`, `circle_activated`, `activity_reminder`, `waitlist_promotion`, `host_approval`, `feedback_request`, `report_update`, `generic`; `payload` is JSONB used by jobs for idempotency. |

**Constraint to know:** despite its name,
`host_applications_pending_unique` is unique on `user_id` alone — one application
row per member ever, not one per pending review. A rejected member cannot submit
a second row without a schema change.

## Uploads

### `uploads`

| Column                                                              | Notes                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `owner_id`                                                          | FK to `users`, cascade delete                                                         |
| `purpose`                                                           | `avatar` \| `activity_cover` \| `venue_photo` \| `report_evidence` \| `host_document` |
| `public_id` (unique), `resource_type`, `delivery_type`              | Cloudinary identity; `upload` (public) or `authenticated` (private)                   |
| `format`, `bytes`, `width`, `height`, `secure_url`, `original_name` |                                                                                       |
| `deleted_at`                                                        | Soft delete after the Cloudinary asset is destroyed                                   |

Rules:

- A form may only reference a row with the same `owner_id` and `purpose`.
- `resource_type` is `image` or `raw`; PDFs are `raw` and private.
- Private rows must never be rendered with `secure_url` — use
  `getAttachmentLinks` (10-minute signed URL).
- Public images still referenced by a user, activity or venue must not be deleted;
  `cleanupReplacedImage` and `deleteUserPublicUploads` check first.

## Deletion behavior

| Action                           | Effect                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Delete account (`deleteAccount`) | Marks `users.deleted_at`, cancels RSVPs, leaves circles, deletes sessions, removes public Cloudinary images. Rows keep their history. |
| Suspend member (admin)           | `users.status = suspended`, deletes sessions; the proxy signs them out.                                                               |
| Delete venue (admin)             | Soft delete + `approved = false`; past activities keep the reference.                                                                 |
| Leave circle                     | `circle_members.status = left`; circle becomes `forming` under 3 active members.                                                      |
| Cancel RSVP                      | `rsvps.status = cancelled`, promotes the next waitlisted member.                                                                      |
| Replace image                    | Old upload soft-deleted and destroyed when no longer referenced.                                                                      |

## Writing schema changes

1. Edit `lib/db/schema.ts` (and relations).
2. `npm run db:generate` → review the generated SQL in `drizzle/`.
3. `npm run db:migrate` locally.
4. Update `docs/data-model.md`, the inferred row types, and any queries that
   select `*`.
5. Add a unit test if the rule is pure (capacity, status narrowing, scoring).
