"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { useErrorMessage } from "@/lib/hooks/use-error-message";
import { useRouter } from "@/i18n/navigation";
import { acceptCircleInvite, declineCircleInvite } from "@/lib/actions/circles";
import { Button } from "@/components/ui/button";

export function CircleInviteActions({ circleId }: { circleId: number }) {
  const t = useTranslations("circles");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function respond(response: "accept" | "decline") {
    startTransition(async () => {
      const result =
        response === "accept"
          ? await acceptCircleInvite(undefined, { circleId })
          : await declineCircleInvite(undefined, { circleId });

      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }

      toast.success(t(response === "accept" ? "inviteAccepted" : "inviteDeclined"));
      if (response === "decline") {
        router.replace("/circles");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => respond("accept")} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        {t("acceptInvite")}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => respond("decline")}
        disabled={pending}
      >
        <X aria-hidden />
        {t("declineInvite")}
      </Button>
    </div>
  );
}
