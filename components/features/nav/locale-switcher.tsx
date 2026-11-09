"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  LOCALE_COOKIE_NAME,
  PREFERENCE_MAX_AGE,
  locales,
  type Locale,
} from "@/i18n/routing";
import { Button } from "@/components/ui/button";

const labels: Record<Locale, string> = { en: "EN", bn: "বাংলা" };

/** Persists the language in a cookie while keeping the current clean URL. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const other = locales.find((l) => l !== locale) ?? "en";

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      aria-label={t("common.language")}
      className={className}
      onClick={() =>
        startTransition(() => {
          document.cookie = `${LOCALE_COOKIE_NAME}=${other}; Path=/; Max-Age=${PREFERENCE_MAX_AGE}; SameSite=Lax`;
          router.replace(pathname, { locale: other });
        })
      }
    >
      {labels[other as Locale]}
    </Button>
  );
}
