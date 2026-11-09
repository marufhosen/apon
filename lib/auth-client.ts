"use client";

import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  phoneNumberClient,
  usernameClient,
} from "better-auth/client/plugins";

/**
 * Browser-side auth client. Talks to `/api/auth/*`, which `proxy.ts` forwards
 * to the Better Auth handler — the project ships no API routes. No secrets
 * live here: Brevo credentials are only read on the server (`lib/email`).
 */
export const authClient = createAuthClient({
  plugins: [usernameClient(), emailOTPClient(), phoneNumberClient()],
});
