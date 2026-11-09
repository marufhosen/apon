"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useErrorMessage } from "@/lib/hooks/use-error-message";
import { useRouter } from "@/i18n/navigation";
import { markAllReadAction } from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const t = useTranslations("notifications");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markAll() {
    startTransition(async () => {
      const result = await markAllReadAction(undefined, {});
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("markAll"));
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={markAll} disabled={pending || disabled}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />}
      {t("markAll")}
    </Button>
  );
}
