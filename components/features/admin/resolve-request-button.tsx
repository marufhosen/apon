"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useErrorMessage } from "@/lib/hooks/use-error-message";
import { useRouter } from "@/i18n/navigation";
import { resolveCircleRequest } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";

export function ResolveRequestButton({ requestId }: { requestId: number }) {
  const t = useTranslations("admin.circles");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function resolve() {
    startTransition(async () => {
      const result = await resolveCircleRequest(undefined, { requestId });
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("requestHandled"));
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={resolve} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
      {t("markHandled")}
    </Button>
  );
}
