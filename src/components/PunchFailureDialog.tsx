import { AlertTriangle, MapPin, RotateCcw, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/en";
import { formatDistance, type PunchFailure } from "@/lib/timeclock";

const LOCATION_CODES = new Set([
  "punch.error.denied",
  "punch.error.unavailable",
  "punch.error.timeout",
  "punch.error.insecure",
  "punch.error.outside",
  "punch.error.noPin",
  "punch.error.needLocation",
]);

/** Can trying again plausibly succeed without someone changing a setting? */
const RETRYABLE = new Set([
  "punch.error.unavailable",
  "punch.error.timeout",
  "punch.error.outside",
  "punch.error.network",
  "punch.error.failed",
  "punch.error.denied",
]);

export function PunchFailureDialog({
  failure,
  projectName,
  onClose,
  onRetry,
}: {
  failure: PunchFailure | null;
  projectName?: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const { t, locale } = useI18n();
  if (!failure) return null;
  const code = failure.code;
  const Icon = code === "punch.error.network" ? WifiOff : LOCATION_CODES.has(code) ? MapPin : AlertTriangle;
  const body = t(`${code}.body` as MessageKey, {
    distance: failure.distance != null ? formatDistance(failure.distance, locale) : "?",
    radius: failure.radius != null ? formatDistance(failure.radius, locale) : "?",
    project: projectName ?? "",
    time: failure.open ? formatDateTime(failure.open.punched_at, locale) : "",
  });
  const showAccuracy = code === "punch.error.outside" && failure.accuracy != null && failure.accuracy > 30;

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="z-[80] overflow-hidden p-0 sm:max-w-md">
        <div className="h-1 w-full bg-destructive" aria-hidden />
        <div className="space-y-4 p-6 pt-5">
          <DialogHeader className="text-left">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-destructive/10 text-destructive">
                <Icon className="size-5" />
              </span>
              <DialogTitle className="font-display text-xl font-bold uppercase">{t(`${code}.title` as MessageKey)}</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-[15px] leading-relaxed text-foreground">{body}</DialogDescription>
          </DialogHeader>
          {code === "punch.error.outside" && failure.distance != null && failure.radius != null ? (
            <div className="space-y-1.5">
              <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 bg-primary"
                  style={{ width: `${Math.min(100, (failure.radius / Math.max(failure.distance, 1)) * 100)}%` }}
                />
              </div>
              <p className="frx-label flex justify-between text-muted-foreground">
                <span>0 m</span>
                <span>
                  {formatDistance(failure.radius, locale)} / {formatDistance(failure.distance, locale)}
                </span>
              </p>
            </div>
          ) : null}
          {showAccuracy ? (
            <p className="rounded-sm bg-muted px-3 py-2 text-[13px] text-muted-foreground">
              {t("punch.error.accuracy", { accuracy: String(failure.accuracy) })}
            </p>
          ) : null}
        </div>
        <DialogFooter className="border-t bg-muted/40 px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            {t("punch.close")}
          </Button>
          {onRetry && RETRYABLE.has(code) ? (
            <Button onClick={onRetry}>
              <RotateCcw className="size-4" />
              {t("punch.retry")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
