import "server-only";

import { env } from "@/lib/env";

/**
 * Pluggable SMS provider.
 *
 * The `console` provider prints the code so phone OTP works out of the box in
 * development. Swap to `twilio` by setting SMS_PROVIDER=twilio plus credentials.
 * Any new provider only has to implement `SmsProvider`.
 */
export interface SmsProvider {
  send(to: string, body: string): Promise<void>;
}

const consoleProvider: SmsProvider = {
  async send(to, body) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "SMS_PROVIDER=console is not allowed in production; configure Twilio or disable phone verification",
      );
    }
    console.log(`\n[sms:console] → ${to}\n${body}\n`);
  },
};

const twilioProvider: SmsProvider = {
  async send(to, body) {
    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM;
    if (!sid || !token || !from) {
      throw new Error("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM");
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Twilio send failed (${res.status}): ${detail}`);
    }
  },
};

export const smsProvider: SmsProvider =
  env.SMS_PROVIDER === "twilio" ? twilioProvider : consoleProvider;

export function sendSms(to: string, body: string): Promise<void> {
  return smsProvider.send(to, body);
}

/** Normalises Bangladeshi mobile numbers to E.164 (+8801XXXXXXXXX). */
export function normalizeBdPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("880")) return `+${digits}`;
  if (digits.startsWith("01")) return `+880${digits.slice(1)}`;
  if (digits.startsWith("1")) return `+880${digits}`;
  return `+${digits}`;
}

/** Cheap validator used by the auth plugin (BD mobile numbers). */
export function isValidBdPhone(raw: string): boolean {
  return /^\+?8801[3-9]\d{8}$/.test(raw.trim());
}
