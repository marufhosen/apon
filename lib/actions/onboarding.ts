"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { type ActionContext, createAction } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { assertSelectableLocation } from "@/lib/queries/locations";
import { resolveOwnedImage } from "@/lib/uploads/server";
import { availability, preferences, userInterests, users } from "@/lib/db/schema";
import {
  areaStepSchema,
  availabilityStepSchema,
  guidelinesStepSchema,
  interestsStepSchema,
  preferencesStepSchema,
} from "@/lib/validations";

/** Step 1 — interests (3–8). Replaced wholesale so edits behave predictably. */
export const saveInterests = createAction({
  schema: interestsStepSchema,
  handler: async (input, { user }: ActionContext) => {
    await db.transaction(async (tx) => {
      await tx.delete(userInterests).where(eq(userInterests.userId, user.id));
      if (input.interestIds.length) {
        await tx
          .insert(userInterests)
          .values(
            input.interestIds.map((interestId) => ({ userId: user.id, interestId })),
          );
      }
    });
    return { count: input.interestIds.length };
  },
  revalidate: ["/onboarding"],
});

/** Step 2 — neighbourhood. */
export const saveArea = createAction({
  schema: areaStepSchema,
  handler: async (input, { user }: ActionContext) => {
    await assertSelectableLocation(input.areaId);
    await db
      .update(users)
      .set({ areaId: input.areaId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { areaId: input.areaId };
  },
  revalidate: ["/onboarding", "/home"],
});

/** Step 3 — weekday × slot availability grid. */
export const saveAvailability = createAction({
  schema: availabilityStepSchema,
  handler: async (input, { user }: ActionContext) => {
    const unique = new Map<string, { weekday: number; slot: string }>();
    for (const s of input.slots) unique.set(`${s.weekday}:${s.slot}`, s);

    await db.transaction(async (tx) => {
      await tx.delete(availability).where(eq(availability.userId, user.id));
      if (unique.size) {
        await tx.insert(availability).values(
          [...unique.values()].map((s) => ({
            userId: user.id,
            weekday: s.weekday,
            slot: s.slot,
          })),
        );
      }
    });
    return { count: unique.size };
  },
  revalidate: ["/onboarding"],
});

/**
 * Step 4 — preferences (+ optional bio/avatar) and guidelines acceptance.
 * Stamping `onboardedAt` here is what unlocks the rest of the app.
 */
export const completeOnboarding = createAction({
  schema: preferencesStepSchema.and(guidelinesStepSchema),
  handler: async (input, { user }: ActionContext) => {
    const now = new Date();
    const avatarUrl = await resolveOwnedImage(
      user.id,
      input.avatarUrl,
      "avatar",
      user.avatarUrl,
    );
    await db.transaction(async (tx) => {
      await tx
        .insert(preferences)
        .values({
          userId: user.id,
          groupSize: input.groupSize,
          womenOnly: input.womenOnly,
          mode: input.mode,
          language: input.language,
        })
        .onConflictDoUpdate({
          target: preferences.userId,
          set: {
            groupSize: input.groupSize,
            womenOnly: input.womenOnly,
            mode: input.mode,
            language: input.language,
            updatedAt: now,
          },
        });

      await tx
        .update(users)
        .set({
          bio: input.bio || null,
          avatarUrl,
          onboardedAt: now,
          guidelinesAcceptedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    });

    return { onboarded: true };
  },
  revalidate: ["/onboarding", "/home", "/"],
});

/** Explicit guidelines acceptance (also reachable from the guidelines page). */
export const acceptGuidelines = createAction({
  schema: guidelinesStepSchema,
  handler: async (_input, { user }: ActionContext) => {
    await db
      .update(users)
      .set({ guidelinesAcceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { accepted: true };
  },
  revalidate: ["/onboarding"],
});

/** Persist the chosen language alongside the browser's locale cookie. */
export const saveLocale = createAction({
  schema: z.object({ locale: z.enum(["en", "bn"]) }),
  handler: async (input, { user }: ActionContext) => {
    await db
      .update(users)
      .set({ locale: input.locale, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { locale: input.locale };
  },
  revalidate: ["/"],
});
