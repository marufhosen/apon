interface SmsConfiguration {
  nodeEnv: "development" | "test" | "production";
  nextPhase?: string;
  provider: "console" | "twilio";
  accountSid?: string;
  authToken?: string;
  from?: string;
}

/**
 * Builds may run without delivery credentials, but every production runtime
 * (including jobs) must refuse to start with an unusable phone-verification gate.
 */
export function productionSmsConfigurationError(input: SmsConfiguration): string | null {
  if (input.nodeEnv !== "production" || input.nextPhase === "phase-production-build") {
    return null;
  }

  if (input.provider === "twilio" && input.accountSid && input.authToken && input.from) {
    return null;
  }

  return (
    "Invalid SMS configuration: production requires SMS_PROVIDER=twilio plus " +
    "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM."
  );
}
