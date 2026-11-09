import { describe, expect, it } from "vitest";

import { productionEmailConfigurationError } from "@/lib/email/config";

describe("production email configuration", () => {
  it("requires a Brevo API key at production runtime", () => {
    expect(
      productionEmailConfigurationError({
        nodeEnv: "production",
      }),
    ).toContain("BREVO_API_KEY");
  });

  it("requires a registered Brevo sender at production runtime", () => {
    expect(
      productionEmailConfigurationError({
        nodeEnv: "production",
        apiKey: "test-api-key",
      }),
    ).toContain("BREVO_SENDER_EMAIL");
  });

  it("allows the production build without delivery credentials", () => {
    expect(
      productionEmailConfigurationError({
        nodeEnv: "production",
        nextPhase: "phase-production-build",
      }),
    ).toBeNull();
  });

  it("accepts configured Brevo delivery", () => {
    expect(
      productionEmailConfigurationError({
        nodeEnv: "production",
        apiKey: "configured-api-key",
        senderEmail: "hello@apon.example",
      }),
    ).toBeNull();
  });
});
