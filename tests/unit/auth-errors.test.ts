import { describe, expect, it } from "vitest";

import { authErrorKey } from "@/lib/auth-errors";

describe("auth error mapping", () => {
  it("shows a delivery-specific message when verification email fails", () => {
    expect(authErrorKey({ code: "EMAIL_DELIVERY_FAILED", status: 500 })).toBe(
      "emailDeliveryFailed",
    );
  });
});
