import { useState } from "react";
import { X } from "lucide-react";
import { PackageDownIcon, useInstallPrompt } from "@/components/InstallAppButton";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const KEY = "frx:install-banner-until";
const DAYS = 30;

/** A phone or tablet: a touch screen as its main pointer, or a mobile browser. */
function isMobileDevice() {
  if (typeof window === "undefined") return false;
  const touch = window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(hover: none)").matches;
  return touch || /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function snoozed() {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * On the dashboard, someone on a phone or tablet is offered the app: the portal added to the home screen. Android and
 * Chrome open their install dialog; iPhone and iPad have none, so the steps are shown. Hidden once installed, and for a
 * month after "Not now".
 */
export function InstallAppBanner() {
  const { t } = useI18n();
  const prompt = useInstallPrompt();
  const [hidden, setHidden] = useState(() => !isMobileDevice() || snoozed());
  const [steps, setSteps] = useState(false);

  if (hidden || prompt.standalone) return null;

  function later() {
    try {
      localStorage.setItem(KEY, String(Date.now() + DAYS * 86_400_000));
    } catch {
      // storage unavailable: the banner just comes back next time
    }
    setHidden(true);
  }

  async function install() {
    if (!(await prompt.install())) setSteps(true);
  }

  return (
    <Card className="mb-6 gap-3 border-primary/40 p-4" style={{ boxShadow: "var(--glass-shadow), inset 3px 0 0 #faa32b" }}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <PackageDownIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight tracking-wide">{t("install.bannerTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("install.bannerText")}</p>
        </div>
        <button type="button" aria-label={t("install.later")} className="-m-1 rounded-lg p-2 text-muted-foreground hover:bg-foreground/10" onClick={later}>
          <X className="size-4" />
        </button>
      </div>
      {steps ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("install.stepsTitle")}</p>
          <p className="mt-1">{t(prompt.helpKey)}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 flex-1 sm:flex-none" onClick={() => void install()}>
          <PackageDownIcon className="size-4" />
          {t("install.bannerAction")}
        </Button>
        <Button variant="ghost" className="h-11" onClick={later}>
          {t("install.later")}
        </Button>
      </div>
    </Card>
  );
}
