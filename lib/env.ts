import "server-only";

import { z } from "zod";

import { productionSmsConfigurationError } from "@/lib/sms/config";

// Standalone scripts (`tsx`) don't get Next's .env loading — do it ourselves.
// `loadEnvFile` never overrides variables already present in the environment.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: validation below reports what is missing.
  }
}

/**
 * All environment variables are validated once, at import time, with Zod.
 * A missing variable fails fast with a readable message instead of surfacing
 * as a runtime error deep inside a request.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .url({ message: "DATABASE_URL must be a postgresql:// connection string" })
    .refine((v) => v.startsWith("postgres"), {
      message: "DATABASE_URL must start with postgres:// or postgresql://",
    }),

  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 chars"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
  SMS_FROM: z.string().default("APON"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("APON <onboarding@resend.dev>"),

  // Cloudinary (image + file uploads). Server-only — never exposed to the
  // browser. Either the three separate variables or CLOUDINARY_URL
  // (cloudinary://<api_key>:<api_secret>@<cloud_name>) may be used.
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  CLOUDINARY_URL: z
    .string()
    .trim()
    .regex(/^cloudinary:\/\/[^:]+:[^@]+@.+$/, {
      message: "CLOUDINARY_URL must look like cloudinary://key:secret@cloud",
    })
    .optional(),
  /** Top-level folder for every asset, e.g. "apon" → apon/avatars/… */
  CLOUDINARY_FOLDER: z.string().trim().default("apon"),
  /** API origin; only overridden by the e2e suite's local Cloudinary stand-in. */
  CLOUDINARY_API_BASE: z.string().url().default("https://api.cloudinary.com"),

  MATCHING_DAY: z.coerce.number().int().min(0).max(6).default(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment variables:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
  );
}

export const env = parsed.data;

/** True when real email delivery is configured (otherwise we log to console). */
export const emailEnabled = Boolean(env.RESEND_API_KEY);

/** True when real SMS delivery is configured (otherwise we log to console). */
export const smsEnabled =
  env.SMS_PROVIDER === "twilio" && Boolean(env.TWILIO_ACCOUNT_SID);

/** Resolved Cloudinary credentials (separate variables win over CLOUDINARY_URL). */
export const cloudinaryConfig = (() => {
  const fromUrl = env.CLOUDINARY_URL?.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  const apiKey = env.CLOUDINARY_API_KEY || fromUrl?.[1];
  const apiSecret =
    env.CLOUDINARY_API_SECRET || (fromUrl ? decodeURIComponent(fromUrl[2]) : undefined);
  const cloudName = env.CLOUDINARY_CLOUD_NAME || fromUrl?.[3];
  return apiKey && apiSecret && cloudName
    ? {
        apiKey,
        apiSecret,
        cloudName,
        folder: env.CLOUDINARY_FOLDER,
        apiBase: env.CLOUDINARY_API_BASE.replace(/\/$/, ""),
      }
    : null;
})();

/** True when uploads can be sent to Cloudinary. */
export const uploadsEnabled = cloudinaryConfig !== null;

const smsConfigurationError = productionSmsConfigurationError({
  nodeEnv: env.NODE_ENV,
  nextPhase: process.env.NEXT_PHASE,
  provider: env.SMS_PROVIDER,
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN,
  from: env.TWILIO_FROM,
});
if (smsConfigurationError) throw new Error(smsConfigurationError);

if (!uploadsEnabled && env.CLOUDINARY_API_KEY && env.NODE_ENV !== "test") {
  console.warn(
    "[env] CLOUDINARY_API_KEY is set but uploads are disabled: also set CLOUDINARY_API_SECRET and " +
      "CLOUDINARY_CLOUD_NAME (or CLOUDINARY_URL). Signed uploads need the secret.",
  );
}
