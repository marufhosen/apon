import { describe, expect, it } from "vitest";

import { canViewFullProfile, pickVisibleArea } from "@/lib/privacy";
import { privacySchema } from "@/lib/validations";

const area = {
  nameEn: "Dhanmondi",
  nameBn: "ধানমন্ডি",
  zoneLabelEn: "Dhanmondi zone",
  zoneLabelBn: "ধানমন্ডি জোন",
};

describe("profile privacy", () => {
  it("lets the owner see their own profile regardless of visibility", () => {
    expect(
      canViewFullProfile({
        profileVisibility: "hidden",
        isOwner: true,
        isSignedIn: true,
        sharesCircle: false,
      }),
    ).toBe(true);
  });

  it("requires a signed-in viewer for member-visible profiles", () => {
    expect(
      canViewFullProfile({
        profileVisibility: "members",
        isOwner: false,
        isSignedIn: false,
        sharesCircle: false,
      }),
    ).toBe(false);
  });

  it("allows all members, but only shared-circle members for circle visibility", () => {
    expect(
      canViewFullProfile({
        profileVisibility: "members",
        isOwner: false,
        isSignedIn: true,
        sharesCircle: false,
      }),
    ).toBe(true);
    expect(
      canViewFullProfile({
        profileVisibility: "circles",
        isOwner: false,
        isSignedIn: true,
        sharesCircle: true,
      }),
    ).toBe(true);
    expect(
      canViewFullProfile({
        profileVisibility: "circles",
        isOwner: false,
        isSignedIn: true,
        sharesCircle: false,
      }),
    ).toBe(false);
  });

  it("never exposes a hidden profile to another member", () => {
    expect(
      canViewFullProfile({
        profileVisibility: "hidden",
        isOwner: false,
        isSignedIn: true,
        sharesCircle: true,
      }),
    ).toBe(false);
  });
});

describe("area visibility", () => {
  it("returns the exact area only when the owner allows it", () => {
    expect(pickVisibleArea(area, "exact", false)).toEqual({
      nameEn: "Dhanmondi",
      nameBn: "ধানমন্ডি",
    });
  });

  it("returns the zone label for zone visibility", () => {
    expect(pickVisibleArea(area, "zone", false)).toEqual({
      nameEn: "Dhanmondi zone",
      nameBn: "ধানমন্ডি জোন",
    });
  });

  it("hides the area, but never hides it from its owner", () => {
    expect(pickVisibleArea(area, "hidden", false)).toBeNull();
    expect(pickVisibleArea(area, "hidden", true)).toEqual({
      nameEn: "Dhanmondi",
      nameBn: "ধানমন্ডি",
    });
    expect(pickVisibleArea(null, "exact", false)).toBeNull();
  });
});

describe("privacy schema", () => {
  it("uses conservative defaults when a setting is missing", () => {
    const parsed = privacySchema.parse({});
    expect(parsed).toEqual({
      profileVisibility: "members",
      showGender: true,
      showAge: true,
      areaVisibility: "zone",
    });
  });

  it("parses form checkboxes without turning 'false' into true", () => {
    const parsed = privacySchema.parse({
      profileVisibility: "circles",
      showGender: "false",
      showAge: "on",
      areaVisibility: "exact",
    });
    expect(parsed.showGender).toBe(false);
    expect(parsed.showAge).toBe(true);
    expect(parsed.profileVisibility).toBe("circles");
    expect(parsed.areaVisibility).toBe("exact");
  });

  it("rejects unknown visibility values", () => {
    expect(privacySchema.safeParse({ profileVisibility: "public" }).success).toBe(false);
    expect(privacySchema.safeParse({ areaVisibility: "everyone" }).success).toBe(false);
  });
});
