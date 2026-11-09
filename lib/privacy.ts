/**
 * Pure profile-visibility rules.
 *
 * Kept out of the query so the decision can be tested without a database and
 * reused anywhere a profile is rendered.
 */

export type ProfileVisibility = "members" | "circles" | "hidden";
export type AreaVisibility = "exact" | "zone" | "hidden";

export interface AreaLabels {
  nameEn: string;
  nameBn: string;
  zoneLabelEn: string;
  zoneLabelBn: string;
}

export interface ProfileVisibilityInput {
  profileVisibility: ProfileVisibility;
  isOwner: boolean;
  isSignedIn: boolean;
  sharesCircle: boolean;
}

/** Whether the viewer may see bio, interests, gender, age and area. */
export function canViewFullProfile({
  profileVisibility,
  isOwner,
  isSignedIn,
  sharesCircle,
}: ProfileVisibilityInput): boolean {
  if (isOwner) return true;
  if (!isSignedIn) return false;
  if (profileVisibility === "members") return true;
  return profileVisibility === "circles" && sharesCircle;
}

/**
 * The area labels a viewer may see. "zone" intentionally returns the matching
 * zone label instead of the exact neighbourhood, and never any coordinates or
 * ids that could identify the member's address.
 */
export function pickVisibleArea(
  area: AreaLabels | null,
  areaVisibility: AreaVisibility,
  isOwner: boolean,
): { nameEn: string; nameBn: string } | null {
  if (!area) return null;
  if (isOwner || areaVisibility === "exact") {
    return { nameEn: area.nameEn, nameBn: area.nameBn };
  }
  if (areaVisibility === "zone") {
    return { nameEn: area.zoneLabelEn, nameBn: area.zoneLabelBn };
  }
  return null;
}
