import { describe, expect, it } from "vitest";

import { activityUrl } from "@/lib/email/urls";

describe("activity email URLs", () => {
  it("deep-links English recipients without exposing the locale", () => {
    expect(activityUrl("https://apon.example/", 42, "en")).toBe(
      "https://apon.example/activities/42",
    );
  });

  it("deep-links Bangla recipients to the same cookie-localized URL", () => {
    expect(activityUrl("https://apon.example", 42, "bn")).toBe(
      "https://apon.example/activities/42",
    );
  });
});
