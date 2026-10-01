import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useClock, useNow } from "@/lib/clock";
import { formatClock, formatDuration, minutesBetween } from "@/lib/timeclock";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

/** Header pill shown on every page while the user is checked in. */
export function ClockBadge() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { open, openProject } = useClock();
  const now = useNow(Boolean(open));
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => navigate("/tools/punch")}
      title={openProject ? `${openProject.project_number} · ${openProject.name}` : t("punch.state.on")}
      className="flex h-8 items-center gap-2 rounded-sm bg-black px-2.5 text-white ring-1 ring-emerald-500/40 transition-colors hover:ring-emerald-400 dark:bg-white/[0.06]"
    >
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
        <span className="relative size-2 rounded-full bg-emerald-400" />
      </span>
      <span className="frx-label hidden text-[9px] text-emerald-300 sm:inline">{t("punch.state.on")}</span>
      <span className="font-mono text-[12px] tabular-nums">{formatClock(now - new Date(open.punched_at).getTime())}</span>
      {openProject ? (
        <span className="frx-label hidden text-[9px] text-white/50 md:inline">{openProject.project_number}</span>
      ) : null}
    </button>
  );
}

/** Asks before signing out while a shift is still open. */
export function SignOutGuard({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const clock = useClock();
  if (!clock.open) return null;
  const project = clock.openProject;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        <div className="frx-beam h-1 w-full" aria-hidden />
        <div className="p-6 pt-5">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-xl font-bold uppercase">{t("punch.signout.title")}</DialogTitle>
            <DialogDescription className="pt-2 text-[15px] leading-relaxed text-foreground">
              {t("punch.signout.body", {
                project: project ? `${project.project_number} ${project.name}` : "—",
                duration: formatDuration(minutesBetween(clock.open.punched_at, new Date().toISOString())),
              })}
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="flex-col gap-2 border-t bg-muted/40 px-6 py-4 sm:flex-row">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("punch.signout.stay")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              navigate("/tools/punch");
            }}
          >
            {t("punch.signout.goPunch")}
          </Button>
          <Button onClick={onConfirm}>{t("punch.signout.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
