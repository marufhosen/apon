import { describe, expect, it } from "vitest";

import { productionSmsConfigurationError } from "@/lib/sms/config";

describe("production SMS configuration", () => {
  it("fails a production runtime that uses the console provider", () => {
    expect(
      productionSmsConfigurationError({
        nodeEnv: "production",
        provider: "console",
      }),
    ).toContain("SMS_PROVIDER=twilio");
  });

  it("allows the production build phase without delivery credentials", () => {
    expect(
      productionSmsConfigurationError({
        nodeEnv: "production",
        nextPhase: "phase-production-build",
        provider: "console",
      }),
    ).toBeNull();
  });

  it("accepts a fully configured Twilio production runtime", () => {
    expect(
      productionSmsConfigurationError({
        nodeEnv: "production",
        provider: "twilio",
        accountSid: "AC123",
        authToken: "secret",
        from: "+8801000000000",
      }),
    ).toBeNull();
  });
});
