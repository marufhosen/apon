"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useErrorMessage } from "@/lib/hooks/use-error-message";
import { useRouter } from "@/i18n/navigation";
import { hideReportedMessage } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";

export function HideMessageButton({ messageId }: { messageId: number }) {
  const t = useTranslations("admin.reports");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function hide() {
    startTransition(async () => {
      const result = await hideReportedMessage(undefined, { messageId });
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("hideMessageDone"));
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={hide} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <EyeOff aria-hidden />}
      {t("hideMessage")}
    </Button>
  );
}
