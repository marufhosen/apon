import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, phoneNumber, username } from "better-auth/plugins";

import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendAccountExistsEmail, sendAuthCodeEmail } from "@/lib/email";
import { isValidBdPhone, normalizeBdPhone, sendSms } from "@/lib/sms";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  isStrongPassword,
  isValidUsername,
} from "@/lib/validations/auth";

/**
 * Better Auth instance — email/username + password authentication.
 *
 *   sign up   POST /sign-up/email          (email, username, password)
 *             → a 6-digit verification code is emailed via Resend
 *   verify    POST /email-otp/verify-email (signs the user in on success)
 *   sign in   POST /sign-in/email | /sign-in/username (verified accounts only)
 *   reset     POST /email-otp/request-password-reset → /email-otp/reset-password
 *
 * Passwords are hashed with Better Auth's scrypt implementation; sessions are
 * database-backed, httpOnly cookies. The old passwordless email-code sign-in
 * and phone-code sign-in are disabled; phone OTP is only used to attach a
 * verified number to a signed-in account.
 *
 * Deliberately free of `next/headers` imports so `proxy.ts` can reuse it.
 * There are no API routes: `proxy.ts` forwards `/api/auth/*` to `auth.handler`.
 */

const isProduction = env.NODE_ENV === "production";

/** The UI locale travels in next-intl's cookie; emails follow it. */
function localeFrom(request?: Request | null): "en" | "bn" {
  const cookie = request?.headers.get("cookie") ?? "";
  return /(?:^|;\s*)NEXT_LOCALE=bn\b/.test(cookie) ? "bn" : "en";
}

/** Endpoints where a password is chosen, and where to find it in the body. */
const PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/email-otp/reset-password": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
};

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      rateLimit: schema.rateLimitBuckets,
    },
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // No session until the email is verified.
    autoSignIn: false,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    // A password reset ends every existing session.
    revokeSessionsOnPasswordReset: true,
    // Same response for new and existing emails; the owner gets a heads-up.
    onExistingUserSignUp: async ({ user }, request) => {
      await sendAccountExistsEmail({ to: user.email, locale: localeFrom(request) }).catch((err) =>
        console.warn("[auth] account-exists email failed:", err instanceof Error ? err.message : err),
      );
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // Unverified sign-in attempts get a fresh code (the UI then shows /verify).
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },

  // The passwordless flows this app used to offer.
  disabledPaths: ["/sign-in/email-otp", "/forget-password/email-otp", "/sign-in/phone-number"],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;

      // Password policy (length + letter + number + not the username/email).
      const field = PASSWORD_FIELDS[ctx.path];
      if (field && typeof body[field] === "string") {
        const personal = [body.username, body.email].filter((v): v is string => typeof v === "string");
        if (!isStrongPassword(body[field] as string, personal)) {
          throw new APIError("BAD_REQUEST", { code: "WEAK_PASSWORD", message: "Password does not meet the requirements" });
        }
      }

      // Email codes are only for verification and password reset — never sign-in.
      if (ctx.path === "/email-otp/send-verification-otp" && body.type === "sign-in") {
        throw new APIError("BAD_REQUEST", { code: "SIGN_IN_CODE_DISABLED", message: "Code sign-in is disabled" });
      }

      // Phone OTP may only attach a number to the signed-in account, not sign in.
      if (ctx.path === "/phone-number/verify" && body.updatePhoneNumber !== true) {
        throw new APIError("BAD_REQUEST", { code: "PHONE_SIGN_IN_DISABLED", message: "Phone sign-in is disabled" });
      }
    }),
  },

  // Postgres-backed rate limiting (counts live in the `rate_limits` table).
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 40,
    customRules: {
      "/sign-up/email": { window: 300, max: 5 },
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-in/username": { window: 60, max: 8 },
      "/email-otp/send-verification-otp": { window: 60, max: 3 },
      "/email-otp/verify-email": { window: 60, max: 10 },
      "/email-otp/request-password-reset": { window: 300, max: 3 },
      "/email-otp/reset-password": { window: 60, max: 10 },
      "/change-password": { window: 60, max: 5 },
      "/is-username-available": { window: 60, max: 30 },
      "/phone-number/send-otp": { window: 60, max: 5 },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the cookie once a day
    freshAge: 60 * 60 * 24, // sensitive actions need a sign-in from the last day
  },

  advanced: {
    // Secure, httpOnly, SameSite=Lax cookies (prefixed __Secure- over HTTPS).
    useSecureCookies: isProduction,
  },

  plugins: [
    username({
      minUsernameLength: USERNAME_MIN,
      maxUsernameLength: USERNAME_MAX,
      usernameValidator: isValidUsername,
    }),

    emailOTP({
      otpLength: 6,
      expiresIn: 600, // 10 minutes
      allowedAttempts: 5,
      // Codes replace Better Auth's link-based verification emails.
      overrideDefaultEmailVerification: true,
      // Codes never create accounts (sign-up is password-based).
      disableSignUp: true,
      // Hashed at rest in production; plain in dev/test so e2e can read them.
      storeOTP: isProduction ? "hashed" : "plain",
      sendVerificationOTP: async ({ email, otp, type }, ctx) => {
        if (type !== "email-verification" && type !== "forget-password") return;
        await sendAuthCodeEmail({ to: email, code: otp, locale: localeFrom(ctx?.request), purpose: type });
      },
    }),

    phoneNumber({
      otpLength: 6,
      expiresIn: 300, // 5 minutes
      allowedAttempts: 3,
      phoneNumberValidator: isValidBdPhone,
      sendOTP: async ({ phoneNumber, code }) => {
        // Let delivery failures reach the caller: a code the member never
        // received must not look like a successful send.
        await sendSms(
          normalizeBdPhone(phoneNumber),
          `Your APON code is ${code}. It expires in 5 minutes. Never share it.`,
        );
      },
    }),

    // Must stay last: reads the session cookie on the way out.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
