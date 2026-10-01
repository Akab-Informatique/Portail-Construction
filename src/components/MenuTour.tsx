import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { TUTORIAL_KEY } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import type { MessageKey } from "@/lib/i18n/en";

type Step = { id: string; title: MessageKey; body: MessageKey };

function laterKey(userId: number) {
  return `${TUTORIAL_KEY}_later_${userId}`;
}

function doneKey(userId: number) {
  return `${TUTORIAL_KEY}_done_${userId}`;
}

export function MenuTour() {
  const { realUser, completeTutorial } = useAuth();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [box, setBox] = useState<DOMRect | null>(null);

  const steps = useMemo<Step[]>(() => {
    const admin = Boolean(realUser?.is_admin);
    // Same order as the menu, top to bottom.
    const list: Step[] = [
      { id: "dashboard", title: "tour.step.dashboard.title", body: "tour.step.dashboard.body" },
      { id: "projectsDocs", title: "tour.step.projectsDocs.title", body: "tour.step.projectsDocs.body" },
      ...(admin ? [{ id: "reports", title: "tour.step.reports.title", body: "tour.step.reports.body" } as Step] : []),
      { id: "operations", title: "tour.step.operations.title", body: "tour.step.operations.body" },
      { id: "documents", title: "tour.step.documents.title", body: "tour.step.documents.body" },
      { id: "tools", title: "tour.step.tools.title", body: "tour.step.tools.body" },
      ...(admin
        ? ([
            { id: "accounting", title: "tour.step.accounting.title", body: "tour.step.accounting.body" },
            { id: "setup", title: "tour.step.setup.title", body: "tour.step.setup.body" },
          ] as Step[])
        : []),
      { id: "profile", title: "tour.step.profile.title", body: "tour.step.profile.body" },
    ];
    return list;
  }, [realUser?.is_admin]);

  const locallyDone =
    typeof window !== "undefined" && realUser ? localStorage.getItem(doneKey(realUser.id)) === "1" : false;

  const active =
    Boolean(realUser) &&
    !realUser?.must_change_password &&
    !realUser?.tutorial_done &&
    !locallyDone &&
    !hidden &&
    !(typeof window !== "undefined" && realUser && sessionStorage.getItem(laterKey(realUser.id)));

  const current = steps[Math.min(step, steps.length - 1)];

  useLayoutEffect(() => {
    if (!active || !current) {
      setBox(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${current.id}"]`) as HTMLElement | null;
    if (!el) {
      setBox(null);
      return;
    }
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setBox(el.getBoundingClientRect());
  }, [active, current, step]);

  useEffect(() => {
    if (!active || !current) return;
    const sync = () => {
      const el = document.querySelector(`[data-tour="${current.id}"]`) as HTMLElement | null;
      setBox(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [active, current]);

  if (!active || !current) return null;

  const last = step >= steps.length - 1;
  const pad = 6;
  const cardW = 320;
  const left = box ? Math.min(window.innerWidth - cardW - 16, box.right + 16) : 16;
  const top = box ? Math.max(16, Math.min(box.top - 8, window.innerHeight - 240)) : 80;

  async function neverShow() {
    if (realUser) {
      try {
        localStorage.setItem(doneKey(realUser.id), "1");
      } catch {
        /* ignore */
      }
    }
    setHidden(true);
    await completeTutorial();
  }

  function later() {
    if (!realUser) return;
    sessionStorage.setItem(laterKey(realUser.id), "1");
    setHidden(true);
  }

  async function next() {
    if (last) {
      await neverShow();
      return;
    }
    setStep((n) => n + 1);
  }

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none">
      <div className="absolute inset-0 bg-black/35 pointer-events-auto" />
      {box ? (
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background transition-all duration-200"
          style={{
            top: box.top - pad,
            left: box.left - pad,
            width: box.width + pad * 2,
            height: box.height + pad * 2,
          }}
        />
      ) : null}
      <div
        className="pointer-events-auto absolute w-[min(20rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 shadow-xl transition-all duration-200"
        style={{ top, left: Math.max(12, left) }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("tour.title")} · {step + 1}/{steps.length}
        </p>
        <h3 className="mt-1 text-base font-semibold">{t(current.title)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(current.body)}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void next()}>
            {last ? t("tour.done") : t("tour.next")}
          </Button>
          <Button type="button" variant="outline" onClick={later}>
            {t("tour.later")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void neverShow()}>
            {t("tour.never")}
          </Button>
        </div>
      </div>
    </div>
  );
}
