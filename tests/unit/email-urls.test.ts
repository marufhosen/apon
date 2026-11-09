import { describe, expect, it } from "vitest";

import { activityUrl } from "@/lib/email/urls";

describe("activity email URLs", () => {
  it("deep-links English recipients to the activity", () => {
    expect(activityUrl("https://apon.example/", 42, "en")).toBe(
      "https://apon.example/en/activities/42",
    );
  });

  it("deep-links Bangla recipients to the activity", () => {
    expect(activityUrl("https://apon.example", 42, "bn")).toBe(
      "https://apon.example/bn/activities/42",
    );
  });
});
