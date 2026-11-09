"use client";

import { useErrorMessage } from "@/lib/hooks/use-error-message";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Languages } from "lucide-react";
import { toast } from "sonner";

import { usePathname, useRouter } from "@/i18n/navigation";
import {
  LOCALE_COOKIE_NAME,
  PREFERENCE_MAX_AGE,
  locales,
  type Locale,
} from "@/i18n/routing";
import { updateLanguage } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LABELS: Record<Locale, string> = { en: "English", bn: "বাংলা" };

/**
 * Saves the preference on the user record and in the locale cookie, then
 * re-renders the current clean URL in the selected language.
 */
export function LanguageForm() {
  const t = useTranslations("settings");
  const errorMessage = useErrorMessage();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<Locale>(locale);
  const [pending, startTransition] = useTransition();

  function apply(next: Locale) {
    setSelected(next);
    startTransition(async () => {
      const result = await updateLanguage(undefined, { locale: next });
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("saved"));
      document.cookie = `${LOCALE_COOKIE_NAME}=${next}; Path=/; Max-Age=${PREFERENCE_MAX_AGE}; SameSite=Lax`;
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{t("languageHint")}</p>

      <div className="flex flex-wrap gap-2">
        {locales.map((option) => (
          <Button
            key={option}
            type="button"
            variant={selected === option ? "default" : "outline"}
            disabled={pending}
            onClick={() => apply(option)}
            className={cn("gap-2")}
          >
            {pending && selected === option ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Languages aria-hidden />
            )}
            {LABELS[option]}
          </Button>
        ))}
      </div>
    </div>
  );
}
