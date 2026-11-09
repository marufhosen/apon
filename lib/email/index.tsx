import "server-only";

import type { ReactElement } from "react";
import { render } from "@react-email/render";
import { emailEnabled, env } from "@/lib/env";
import { EmailButton, EmailLayout, EmailParagraph, OtpCode } from "@/lib/email/templates";
import { activityUrl } from "@/lib/email/urls";

/**
 * Email delivery.
 *
 * Uses Brevo when BREVO_API_KEY and a registered sender are configured.
 * Without it — development only — messages are printed to the server console
 * so sign-up verification works with zero setup.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  react: ReactElement;
  delivery?: "best-effort" | "required";
}

export async function sendEmail({
  to,
  subject,
  react,
  delivery = "best-effort",
}: SendEmailInput): Promise<void> {
  if (!emailEnabled) {
    // Development fallback only — production refuses to send auth codes this way.
    if (env.NODE_ENV !== "production")
      console.log(`\n[email:dev] → ${to} | ${subject}\n`);
    return;
  }

  try {
    if (!env.BREVO_API_KEY) throw new Error("BREVO_API_KEY is not set");
    if (!env.BREVO_SENDER_EMAIL) {
      throw new Error("BREVO_SENDER_EMAIL is not set");
    }
    const html = await render(react);
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: env.BREVO_SENDER_EMAIL,
          name: env.BREVO_SENDER_NAME,
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      const detail = payload?.message ?? payload?.code ?? response.statusText;
      throw new Error(`Brevo failed with HTTP ${response.status}: ${detail}`);
    }
  } catch (err) {
    console.warn(
      `[email:brevo:warn] Error sending to ${to}:`,
      err instanceof Error ? err.message : err,
    );
    if (delivery === "required" || env.NODE_ENV !== "development") {
      throw err;
    }
    return;
  }
}

const appUrl = () => env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Typed senders — one per notification the product sends
// ---------------------------------------------------------------------------

export type AuthCodePurpose = "email-verification" | "forget-password";

/**
 * Account verification / password-reset code. Sent through Brevo's transactional
 * email API; never logged in production.
 */
export function sendAuthCodeEmail(input: {
  to: string;
  code: string;
  locale: string;
  purpose: AuthCodePurpose;
}) {
  if (!emailEnabled && env.NODE_ENV === "production") {
    // Never fall back to logging a credential code in production.
    throw new Error("BREVO_API_KEY must be set in production to send verification codes");
  }
  const bn = input.locale === "bn";
  const verify = input.purpose === "email-verification";
  const copy = verify
    ? {
        subject: bn
          ? `APON ইমেইল যাচাই কোড: ${input.code}`
          : `Verify your APON email: ${input.code}`,
        preview: bn
          ? "আপনার APON অ্যাকাউন্ট যাচাই করুন"
          : "Confirm your email to finish creating your APON account",
        heading: bn ? "আপনার ইমেইল যাচাই করুন" : "Verify your email",
        body: bn
          ? "APON-এ স্বাগতম! অ্যাকাউন্ট খোলা শেষ করতে নিচের কোডটি দিন। কোডটি ১০ মিনিট পর্যন্ত কাজ করবে।"
          : "Welcome to APON! Enter the code below to finish creating your account. It is valid for 10 minutes.",
      }
    : {
        subject: bn
          ? `APON পাসওয়ার্ড রিসেট কোড: ${input.code}`
          : `Reset your APON password: ${input.code}`,
        preview: bn
          ? "আপনার পাসওয়ার্ড রিসেট করুন"
          : "Use this code to choose a new password",
        heading: bn ? "পাসওয়ার্ড রিসেট করুন" : "Reset your password",
        body: bn
          ? "নতুন পাসওয়ার্ড সেট করতে নিচের কোডটি দিন। কোডটি ১০ মিনিট পর্যন্ত কাজ করবে। রিসেটের পর আপনার সব ডিভাইস থেকে সাইন আউট হয়ে যাবে।"
          : "Enter the code below to choose a new password. It is valid for 10 minutes. Resetting signs you out on every device.",
      };

  return sendEmail({
    to: input.to,
    subject: copy.subject,
    delivery: "required",
    react: (
      <EmailLayout preview={copy.preview} heading={copy.heading}>
        <EmailParagraph>{copy.body}</EmailParagraph>
        <OtpCode code={input.code} />
        <EmailParagraph>
          {bn
            ? "এই কোডটি কাউকে জানাবেন না — APON কখনো আপনার কাছে কোড চাইবে না। আপনি অনুরোধ না করে থাকলে ইমেইলটি এড়িয়ে যান।"
            : "Never share this code — APON will never ask you for it. If you didn't request it, you can ignore this email."}
        </EmailParagraph>
      </EmailLayout>
    ),
  });
}

/**
 * Sent when someone tries to sign up with an email that already has an account.
 * The sign-up form shows the same response either way, so emails can't be probed.
 */
export function sendAccountExistsEmail(input: { to: string; locale: string }) {
  const bn = input.locale === "bn";
  return sendEmail({
    to: input.to,
    subject: bn
      ? "আপনার ইতিমধ্যে একটি APON অ্যাকাউন্ট আছে"
      : "You already have an APON account",
    react: (
      <EmailLayout
        preview={
          bn ? "সাইন ইন করুন বা পাসওয়ার্ড রিসেট করুন" : "Sign in or reset your password"
        }
        heading={bn ? "আপনার অ্যাকাউন্ট আছে" : "You already have an account"}
      >
        <EmailParagraph>
          {bn
            ? "কেউ (সম্ভবত আপনি) এই ইমেইল দিয়ে নতুন অ্যাকাউন্ট খোলার চেষ্টা করেছেন। আপনার অ্যাকাউন্ট আগে থেকেই আছে — সাইন ইন করুন, অথবা পাসওয়ার্ড ভুলে গেলে রিসেট করুন।"
            : "Someone (probably you) tried to create a new account with this email. You already have one — sign in, or reset your password if you've forgotten it."}
        </EmailParagraph>
        <EmailButton
          href={`${appUrl()}/${bn ? "bn" : "en"}/sign-in`}
          label={bn ? "সাইন ইন" : "Sign in"}
        />
        <EmailParagraph>
          {bn
            ? "এটি আপনি না হলে ইমেইলটি নিশ্চিন্তে এড়িয়ে যান।"
            : "If this wasn't you, you can safely ignore this email."}
        </EmailParagraph>
      </EmailLayout>
    ),
  });
}

export function sendCircleInviteEmail(input: {
  to: string;
  locale: string;
  circleId: number;
  circleName: string;
  memberCount: number;
}) {
  const bn = input.locale === "bn";
  return sendEmail({
    to: input.to,
    subject: bn
      ? `আপনার সাপ্তাহিক সার্কেল তৈরি হয়েছে — ${input.circleName}`
      : `Your weekly circle is ready — ${input.circleName}`,
    react: (
      <EmailLayout
        preview={
          bn ? "আপনার নতুন সার্কেল অপেক্ষা করছে" : "You have been invited to a circle"
        }
        heading={input.circleName}
        footer={`${bn ? "নোটিফিকেশন সেটিংস" : "Notification settings"}: ${appUrl()}/${bn ? "bn" : "en"}/settings`}
      >
        <EmailParagraph>
          {bn
            ? `আপনার আগ্রহ আর ফাঁকা সময় মিলিয়ে ${input.memberCount} জনের একটি ছোট সার্কেল তৈরি হয়েছে। প্রথমে সবাই মিলে ঠিক করুন, কোন দিন দেখা হবে।`
            : `A small circle of ${input.memberCount} people has been formed around your interests and availability. Start by picking the day that works for everyone.`}
        </EmailParagraph>
        <EmailButton
          href={`${appUrl()}/${bn ? "bn" : "en"}/circles/${input.circleId}`}
          label={bn ? "সার্কেল দেখুন" : "Open your circle"}
        />
      </EmailLayout>
    ),
  });
}

export function sendActivityReminderEmail(input: {
  to: string;
  locale: string;
  activityId: number;
  title: string;
  when: string;
  address?: string;
}) {
  const bn = input.locale === "bn";
  return sendEmail({
    to: input.to,
    subject: bn ? `আগামীকাল: ${input.title}` : `Tomorrow: ${input.title}`,
    react: (
      <EmailLayout
        preview={input.title}
        heading={input.title}
        footer={`${bn ? "নোটিফিকেশন সেটিংস" : "Notification settings"}: ${appUrl()}/${bn ? "bn" : "en"}/settings`}
      >
        <EmailParagraph>
          {bn ? "আপনি যাচ্ছেন:" : "You are going:"} {input.when}
        </EmailParagraph>
        {input.address ? (
          <EmailParagraph>
            {bn ? "ঠিকানা:" : "Address:"} {input.address}
          </EmailParagraph>
        ) : null}
        <EmailButton
          href={activityUrl(appUrl(), input.activityId, input.locale)}
          label={bn ? "বিস্তারিত দেখুন" : "View details"}
        />
      </EmailLayout>
    ),
  });
}

export function sendWaitlistPromotionEmail(input: {
  to: string;
  locale: string;
  activityId: number;
  title: string;
  when: string;
}) {
  const bn = input.locale === "bn";
  return sendEmail({
    to: input.to,
    subject: bn
      ? `আপনার জন্য একটি আসন খালি হয়েছে — ${input.title}`
      : `A spot opened up — ${input.title}`,
    react: (
      <EmailLayout
        preview={input.title}
        heading={bn ? "আপনার আসন নিশ্চিত!" : "You are in!"}
        footer={`${bn ? "নোটিফিকেশন সেটিংস" : "Notification settings"}: ${appUrl()}/${bn ? "bn" : "en"}/settings`}
      >
        <EmailParagraph>
          {bn
            ? `“${input.title}” আয়োজনে একটি আসন খালি হয়েছিল — অপেক্ষার তালিকা থেকে আপনার আসনটি নিশ্চিত করা হয়েছে।`
            : `A spot opened up for "${input.title}" and you have been moved from the waitlist.`}
        </EmailParagraph>
        <EmailParagraph>{input.when}</EmailParagraph>
        <EmailButton
          href={activityUrl(appUrl(), input.activityId, input.locale)}
          label={bn ? "আয়োজনটি দেখুন" : "View activity"}
        />
      </EmailLayout>
    ),
  });
}

export function sendHostApprovalEmail(input: {
  to: string;
  locale: string;
  approved: boolean;
}) {
  const bn = input.locale === "bn";
  const title = input.approved
    ? bn
      ? "আপনি এখন হোস্ট!"
      : "You are a host now"
    : bn
      ? "আপনার আবেদনের ফলাফল"
      : "About your host application";
  return sendEmail({
    to: input.to,
    subject: title,
    react: (
      <EmailLayout preview={title} heading={title}>
        <EmailParagraph>
          {input.approved
            ? bn
              ? "অভিনন্দন! এখন থেকে আপনি নতুন আয়োজন তৈরি করতে পারবেন। প্রতিটি আয়োজন অ্যাডমিনের অনুমোদনের পর সবার জন্য প্রকাশ পাবে।"
              : "Congratulations! You can now create activities. Each activity is published after an admin approves it."
            : bn
              ? "দুঃখিত, এবার আপনার আবেদনটি অনুমোদন করা গেল না। কিছুদিন পর আবার আবেদন করতে পারবেন।"
              : "Unfortunately we can't approve your application at this time. You are welcome to apply again later."}
        </EmailParagraph>
        <EmailButton
          href={`${appUrl()}/${bn ? "bn" : "en"}/host`}
          label={bn ? "হোস্ট ড্যাশবোর্ড" : "Host dashboard"}
        />
      </EmailLayout>
    ),
  });
}

export function sendFeedbackRequestEmail(input: {
  to: string;
  locale: string;
  activityId: number;
  title: string;
  circleName?: string;
}) {
  const bn = input.locale === "bn";
  return sendEmail({
    to: input.to,
    subject: bn
      ? "আড্ডা কেমন হলো? — আপনার মতামত জানান"
      : "How was it? — share your feedback",
    react: (
      <EmailLayout
        preview={input.title}
        heading={bn ? "কেমন লাগল?" : "How did it go?"}
        footer={`${bn ? "নোটিফিকেশন সেটিংস" : "Notification settings"}: ${appUrl()}/${bn ? "bn" : "en"}/settings`}
      >
        <EmailParagraph>
          {bn
            ? `“${input.title}” শেষ হয়েছে। তিনটি ছোট প্রশ্নের উত্তর দিতে এক মিনিট সময় দিন — আপনার উত্তর অন্য কেউ দেখবে না।`
            : `"${input.title}" has wrapped up. Take a minute to answer three questions — they stay private.`}
        </EmailParagraph>
        <EmailButton
          href={activityUrl(appUrl(), input.activityId, input.locale)}
          label={bn ? "মতামত দিন" : "Give feedback"}
        />
      </EmailLayout>
    ),
  });
}
