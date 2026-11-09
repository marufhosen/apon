"use server";

import "server-only";

import { z } from "zod";

import { getCurrentUser } from "@/lib/session";
import { getLocationChildren, searchLocations } from "@/lib/queries/locations";
import type { LocationOption, LocationSearchResult } from "@/lib/geo/levels";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Read-only lookups for the client-side location picker. The tree is ~6k
 * rows, far too many to ship to the browser, so the picker loads one level
 * at a time. Signed-in users only, to keep the endpoints from being scraped.
 */

const parentSchema = z.number().int().positive().nullable();
const querySchema = z.string().trim().min(2).max(60);

export async function loadLocationChildren(
  parentId: number | null,
): Promise<LocationOption[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const allowed = await consumeRateLimit(
    `app:locationSearch:${user.id}`,
    RATE_LIMITS.locationSearch,
  );
  if (!allowed.ok) return [];
  const parsed = parentSchema.safeParse(parentId);
  if (!parsed.success) return [];
  return getLocationChildren(parsed.data);
}

export async function findLocations(query: string): Promise<LocationSearchResult[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const allowed = await consumeRateLimit(
    `app:locationSearch:${user.id}`,
    RATE_LIMITS.locationSearch,
  );
  if (!allowed.ok) return [];
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return [];
  return searchLocations(parsed.data, 12);
}
