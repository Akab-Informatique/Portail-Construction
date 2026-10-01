import { MapPin, MapPinOff, Navigation, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { projectFence } from "@/lib/timeclock";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PunchRuleState = "required" | "anywhere" | "noPin";

export function punchRuleState(project: Pick<Project, "require_geofence" | "geo_lat" | "geo_lng" | "geo_radius_m">): PunchRuleState {
  if (!project.require_geofence) return "anywhere";
  return projectFence(project as Project) ? "required" : "noPin";
}

const TONE: Record<PunchRuleState, string> = {
  required: "border-primary/60 bg-primary/10 text-foreground",
  anywhere: "border-border bg-muted/60 text-foreground",
  noPin: "border-destructive/50 bg-destructive/10 text-destructive",
};

/** Big banner telling the crew exactly where they may check in. */
export function PunchRuleBanner({ project, className }: { project: Project; className?: string }) {
  const { t } = useI18n();
  const state = punchRuleState(project);
  const radius = projectFence(project)?.radius ?? project.geo_radius_m ?? 200;
  const Icon = state === "required" ? MapPin : state === "noPin" ? ShieldAlert : MapPinOff;
  return (
    <div className={cn("flex gap-3 rounded-md border px-4 py-3", TONE[state], className)} role="status">
      <span
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-sm",
          state === "required" ? "bg-primary text-black" : state === "noPin" ? "bg-destructive text-white" : "bg-card",
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-[17px] font-bold uppercase leading-tight tracking-wide">
          {t(state === "required" ? "punch.rule.required" : state === "noPin" ? "punch.rule.noPin" : "punch.rule.anywhere")}
        </p>
        <p className={cn("mt-0.5 text-[13px]", state === "noPin" ? "" : "text-muted-foreground")}>
          {state === "required"
            ? t("punch.rule.requiredDesc", { meters: String(radius) })
            : state === "noPin"
              ? t("punch.rule.noPinDesc")
              : t("punch.rule.anywhereDesc")}
        </p>
      </div>
    </div>
  );
}

/** Compact chip for headers; clickable when `onClick` is given (admins editing the rule). */
export function PunchRuleChip({ project, onClick }: { project: Project; onClick?: () => void }) {
  const { t } = useI18n();
  const state = punchRuleState(project);
  const radius = projectFence(project)?.radius ?? 200;
  const label =
    state === "required"
      ? t("punch.chip.required", { meters: String(radius) })
      : state === "noPin"
        ? t("punch.chip.noPin")
        : t("punch.chip.anywhere");
  const Icon = state === "required" ? Navigation : state === "noPin" ? ShieldAlert : MapPinOff;
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, title: t("punch.geo.edit") } : {})}
      className={cn(
        "frx-label inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[10px]",
        TONE[state],
        onClick && "transition-colors hover:border-foreground/40",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </Tag>
  );
}
