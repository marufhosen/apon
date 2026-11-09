"use client";

import { useErrorMessage } from "@/lib/hooks/use-error-message";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { useRouter } from "@/i18n/navigation";
import { updatePrivacySettings } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

export interface PrivacyValues {
  profileVisibility: "members" | "circles" | "hidden";
  showGender: boolean;
  showAge: boolean;
  areaVisibility: "exact" | "zone" | "hidden";
}

export function PrivacyForm({ initial }: { initial: PrivacyValues }) {
  const t = useTranslations("settings");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [values, setValues] = useState<PrivacyValues>(initial);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updatePrivacySettings(undefined, values);
      if (!result.ok) {
        toast.error(errorMessage(result.error, "errors.validation"));
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="profileVisibility">{t("profileVisibility")}</Label>
        <NativeSelect
          id="profileVisibility"
          value={values.profileVisibility}
          onChange={(e) =>
            setValues((current) => ({
              ...current,
              profileVisibility: e.target.value as PrivacyValues["profileVisibility"],
            }))
          }
        >
          <option value="members">{t("profileVisibilityMembers")}</option>
          <option value="circles">{t("profileVisibilityCircles")}</option>
          <option value="hidden">{t("profileVisibilityHidden")}</option>
        </NativeSelect>
        <p className="text-muted-foreground text-xs">{t("profileVisibilityHint")}</p>
      </div>

      <div className="space-y-3">
        <div className="border-border bg-card flex items-start justify-between gap-4 rounded-xl border p-4">
          <div className="space-y-1">
            <Label htmlFor="showGender" className="cursor-pointer">
              {t("showGender")}
            </Label>
            <p className="text-muted-foreground text-xs">{t("showGenderHint")}</p>
          </div>
          <Switch
            id="showGender"
            checked={values.showGender}
            onCheckedChange={(checked) =>
              setValues((current) => ({ ...current, showGender: Boolean(checked) }))
            }
          />
        </div>

        <div className="border-border bg-card flex items-start justify-between gap-4 rounded-xl border p-4">
          <div className="space-y-1">
            <Label htmlFor="showAge" className="cursor-pointer">
              {t("showAge")}
            </Label>
            <p className="text-muted-foreground text-xs">{t("showAgeHint")}</p>
          </div>
          <Switch
            id="showAge"
            checked={values.showAge}
            onCheckedChange={(checked) =>
              setValues((current) => ({ ...current, showAge: Boolean(checked) }))
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="areaVisibility">{t("areaVisibility")}</Label>
        <NativeSelect
          id="areaVisibility"
          value={values.areaVisibility}
          onChange={(e) =>
            setValues((current) => ({
              ...current,
              areaVisibility: e.target.value as PrivacyValues["areaVisibility"],
            }))
          }
        >
          <option value="exact">{t("areaVisibilityExact")}</option>
          <option value="zone">{t("areaVisibilityZone")}</option>
          <option value="hidden">{t("areaVisibilityHidden")}</option>
        </NativeSelect>
        <p className="text-muted-foreground text-xs">{t("areaVisibilityHint")}</p>
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Save aria-hidden />
        )}
        {t("savePrivacy")}
      </Button>
    </div>
  );
}
