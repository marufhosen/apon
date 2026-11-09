import { defineRouting } from "next-intl/routing";

export const locales = ["en", "bn"] as const;
export type Locale = (typeof locales)[number];
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  // The locale stays in a durable cookie; URLs remain language-neutral.
  localePrefix: "never",
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: PREFERENCE_MAX_AGE,
    sameSite: "lax",
    path: "/",
  },
});

export const localeNames: Record<Locale, string> = {
  en: "English",
  bn: "বাংলা",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
