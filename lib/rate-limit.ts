import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Postgres-backed fixed-window rate limiting.
 *
 * Rows live in the same `rate_limits` table Better Auth uses for its own
 * endpoints; our keys are namespaced with `app:` so the two never collide.
 * One statement, so it stays correct under concurrency.
 */
export async function consumeRateLimit(
  key: string,
  opts: { max: number; windowSec: number },
): Promise<{ ok: boolean; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const window = opts.windowSec;

  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, count, last_request)
    VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.last_request + ${window} < ${now} THEN 1
        ELSE rate_limits.count + 1
      END,
      last_request = CASE
        WHEN rate_limits.last_request + ${window} < ${now} THEN ${now}
        ELSE rate_limits.last_request
      END
    RETURNING count
  `);

  const count = Number(rows[0]?.count ?? 1);
  return {
    ok: count <= opts.max,
    remaining: Math.max(0, opts.max - count),
  };
}

/** Limits applied to the mutations that are easiest to spam. */
export const RATE_LIMITS = {
  otpRequest: { max: 5, windowSec: 300 },
  rsvp: { max: 20, windowSec: 300 },
  message: { max: 15, windowSec: 60 },
  report: { max: 5, windowSec: 600 },
  feedback: { max: 10, windowSec: 600 },
  circleRequest: { max: 3, windowSec: 3600 },
  upload: { max: 20, windowSec: 600 },
  poll: { max: 20, windowSec: 300 },
  safety: { max: 20, windowSec: 600 },
  profile: { max: 20, windowSec: 600 },
  circleMutation: { max: 10, windowSec: 600 },
  locationSearch: { max: 60, windowSec: 60 },
} as const;
