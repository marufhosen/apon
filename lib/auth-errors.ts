/**
 * Maps Better Auth error responses to `auth.errors.*` translation keys.
 * Credential failures are deliberately generic so they don't reveal whether
 * an email or username exists.
 */
export function authErrorKey(
  error: { code?: string; status?: number; message?: string } | null | undefined,
): string {
  if (!error) return "generic";
  if (error.status === 429) return "rateLimited";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_USERNAME_OR_PASSWORD":
    case "USER_NOT_FOUND":
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
    case "INVALID_PASSWORD":
      return "invalidCredentials";
    case "USERNAME_IS_ALREADY_TAKEN":
    case "USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER":
      return "usernameTaken";
    case "USERNAME_IS_INVALID":
    case "USERNAME_TOO_SHORT":
    case "USERNAME_TOO_LONG":
    case "INVALID_USERNAME":
      return "usernameInvalid";
    case "INVALID_EMAIL":
      return "emailInvalid";
    case "WEAK_PASSWORD":
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return "passwordWeak";
    case "INVALID_OTP":
    case "OTP_EXPIRED":
      return "otpInvalid";
    case "TOO_MANY_ATTEMPTS":
      return "tooManyAttempts";
    case "EMAIL_DELIVERY_FAILED":
      return "emailDeliveryFailed";
    default:
      return "generic";
  }
}
