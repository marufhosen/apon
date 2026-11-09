interface EmailConfiguration {
  nodeEnv: "development" | "test" | "production";
  nextPhase?: string;
  apiKey?: string;
  senderEmail?: string;
}

/** Production must have Brevo credentials and a registered sender. */
export function productionEmailConfigurationError(
  input: EmailConfiguration,
): string | null {
  if (input.nodeEnv !== "production" || input.nextPhase === "phase-production-build") {
    return null;
  }
  if (!input.apiKey) return "Production email requires BREVO_API_KEY.";
  if (!input.senderEmail) {
    return "Production email requires BREVO_SENDER_EMAIL registered in Brevo.";
  }
  return null;
}
