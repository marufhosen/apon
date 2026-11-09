export const THEME_COOKIE_NAME = "APON_THEME";
export const THEME_STORAGE_KEY = "bondhu-theme";
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}
