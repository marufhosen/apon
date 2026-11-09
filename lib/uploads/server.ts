import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { ActionError } from "@/lib/actions/action";
import { db } from "@/lib/db";
import { activities, uploads, users, venues, type Upload } from "@/lib/db/schema";
import { destroyAsset, privateDownloadUrl } from "@/lib/cloudinary";
import { uploadsEnabled } from "@/lib/env";
import type { UploadPurpose } from "@/lib/uploads/policy";

/**
 * Ownership rules for uploaded files.
 *
 * A form may only save a Cloudinary URL / attachment id that the *same user*
 * uploaded for the *same purpose*. Legacy values already stored on the record
 * are accepted unchanged so existing profiles keep working.
 */

/** Validate a public image URL from a form. Returns the value to store. */
export async function resolveOwnedImage(
  userId: string,
  url: string | null | undefined,
  purpose: Extract<UploadPurpose, "avatar" | "activity_cover" | "venue_photo">,
  currentUrl?: string | null,
): Promise<string | null> {
  const value = url?.trim() || null;
  if (!value) return null;
  if (currentUrl && value === currentUrl) return value;
  const [row] = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      and(
        eq(uploads.ownerId, userId),
        eq(uploads.purpose, purpose),
        eq(uploads.secureUrl, value),
        eq(uploads.deliveryType, "upload"),
        isNull(uploads.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ActionError("uploads.errors.notYours");
  return value;
}

/** Validate a private attachment id from a form. */
export async function resolveOwnedAttachment(
  userId: string,
  uploadId: number | null | undefined,
  purpose: Extract<UploadPurpose, "report_evidence" | "host_document">,
): Promise<number | null> {
  if (!uploadId) return null;
  const [row] = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      and(eq(uploads.id, uploadId), eq(uploads.ownerId, userId), eq(uploads.purpose, purpose), isNull(uploads.deletedAt)),
    )
    .limit(1);
  if (!row) throw new ActionError("uploads.errors.notYours");
  return row.id;
}

async function isStillReferenced(url: string): Promise<boolean> {
  const [hit] = await db.execute<{ n: number }>(sql`
    select (
      (select count(*) from ${users} where ${users.avatarUrl} = ${url}) +
      (select count(*) from ${activities} where ${activities.imageUrl} = ${url}) +
      (select count(*) from ${venues} where ${venues.imageUrl} = ${url})
    )::int as n
  `);
  return Number(hit?.n ?? 0) > 0;
}

async function deleteUploadRow(row: Upload) {
  try {
    await destroyAsset(row);
  } catch (err) {
    console.warn("[uploads] Cloudinary destroy failed:", err instanceof Error ? err.message : err);
  }
  await db.update(uploads).set({ deletedAt: new Date() }).where(eq(uploads.id, row.id));
}

/**
 * After an image is replaced, delete the previous Cloudinary asset if nothing
 * references it any more. Best effort — never fails the user's save.
 */
export async function cleanupReplacedImage(previousUrl: string | null | undefined, nextUrl: string | null) {
  if (!uploadsEnabled || !previousUrl || previousUrl === nextUrl) return;
  try {
    const [row] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.secureUrl, previousUrl), isNull(uploads.deletedAt)))
      .limit(1);
    if (row && !(await isStillReferenced(previousUrl))) await deleteUploadRow(row);
  } catch (err) {
    console.warn("[uploads] cleanup failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * On account deletion: remove every upload the member owns.
 *
 * Private evidence/documents are always destroyed. A public image still used
 * by an activity or venue record is kept so that history does not break, but
 * the member's own avatar/profile references have already been cleared.
 */
export async function deleteUserUploads(userId: string) {
  const rows = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.ownerId, userId), isNull(uploads.deletedAt)));
  for (const row of rows) {
    if (row.deliveryType === "upload" && (await isStillReferenced(row.secureUrl))) continue;
    await deleteUploadRow(row);
  }
}

export interface AttachmentLink {
  id: number;
  name: string;
  format: string;
  bytes: number;
  /** Short-lived signed link (10 minutes). Null when Cloudinary isn't configured. */
  url: string | null;
}

/** Signed, expiring links for private attachments (admin views only). */
export async function getAttachmentLinks(ids: (number | null | undefined)[]): Promise<Map<number, AttachmentLink>> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select()
    .from(uploads)
    .where(and(or(...wanted.map((id) => eq(uploads.id, id))), isNull(uploads.deletedAt)));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.originalName,
        format: row.format,
        bytes: row.bytes,
        url: uploadsEnabled ? privateDownloadUrl(row) : null,
      },
    ]),
  );
}
