"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  THEME_COOKIE_NAME,
  THEME_MAX_AGE,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme";

/**
 * Light/dark toggle.
 *
 * The theme itself lives in the `dark` class on `<html>` (written before paint
 * by the server/root layout) and in a cookie. localStorage is retained as a
 * migration fallback for existing browsers. We read the class
 * through `useSyncExternalStore` rather than mirroring it into state inside an
 * effect: no cascading render, and the server snapshot stays "light".
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const serverTheme = () => "light" as Theme;

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("common");
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);
  const isDark = theme === "dark";

  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE_NAME}=${next}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax`;
    localStorage.setItem(THEME_STORAGE_KEY, next);
    emit();
  }, []);

  return (
    <Button
      variant="ghost"
      size="iconSm"
      className={className}
      onClick={toggle}
      aria-label={isDark ? t("switchToLight") : t("switchToDark")}
      aria-pressed={isDark}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
