import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PROJECT_PHASES } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { projectColor } from "@/lib/project-colors";
import { projectAchievement, type TaskLite } from "@/lib/project-progress";
import { projectSectionPath } from "@/lib/project-nav";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import type { Client, Project } from "@/lib/types";

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

/** Seven phases as one segmented bar: finished ones filled, the current one lit, the rest faint. */
function PhaseBar({ project, color }: { project: Project; color: string }) {
  const { t } = useI18n();
  const finished = project.status === "completed";
  const current = Math.max(0, PROJECT_PHASES.findIndex((p) => p.value === project.phase));
  return (
    <div>
      <div className="flex gap-1">
        {PROJECT_PHASES.map((phase, i) => {
          const done = finished || i < current;
          const now = !finished && i === current;
          return (
            <span
              key={phase.value}
              title={t(`phase.${phase.value}` as MessageKey)}
              className={cn("h-2 flex-1 rounded-full transition-colors", now && "frx-phase-now")}
              style={{
                background: done || now ? color : `color-mix(in srgb, ${color} 16%, transparent)`,
                opacity: done ? 0.55 : 1,
                boxShadow: now ? `0 0 0 2px color-mix(in srgb, ${color} 30%, transparent), 0 0 12px ${color}` : undefined,
              }}
            />
          );
        })}
      </div>
      <p className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        <span className="font-semibold" style={{ color }}>
          {finished ? t("status.completed") : t(`phase.${project.phase}` as MessageKey)}
        </span>
        <span className="tabular-nums">{t("cab.phaseOf", { n: finished ? PROJECT_PHASES.length : current + 1, total: PROJECT_PHASES.length })}</span>
      </p>
    </div>
  );
}

function ProjectFolder({ project, tasks, index, open }: { project: Project; tasks: TaskLite[]; index: number; open: boolean }) {
  const { t, locale } = useI18n();
  const c = projectColor(project);
  const a = projectAchievement(project, tasks);
  const today = todayISO();
  const start = project.start_date || project.end_date;
  const end = project.end_date || project.start_date;
  const left = end ? days(today, end) : null;
  const late = project.status !== "completed" && left !== null && left < 0;
  return (
    <Link
      to={projectSectionPath(project.id, "documents")}
      tabIndex={open ? 0 : -1}
      className="frx-folder group relative block"
      data-open={open}
      style={{ transitionDelay: open ? `${120 + index * 70}ms` : "0ms" }}
    >
      {/* the tab sticking out of the folder */}
      <span className="absolute -top-2 left-4 h-3 w-16 rounded-t-md" style={{ background: c, opacity: 0.85 }} />
      <div
        className="relative overflow-hidden rounded-lg rounded-tl-none border px-4 py-3 transition-all group-hover:-translate-y-1 group-hover:shadow-xl"
        style={{
          background: `linear-gradient(160deg, color-mix(in srgb, ${c} 16%, var(--card)), color-mix(in srgb, ${c} 5%, var(--card)) 75%)`,
          borderColor: `color-mix(in srgb, ${c} 32%, var(--border))`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), 0 6px 14px -8px color-mix(in srgb, ${c} 70%, black)`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{project.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {project.project_number}
              {project.city ? ` · ${project.city}` : ""}
            </p>
          </div>
          <StatusBadge value={project.status} />
        </div>

        <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <PhaseBar project={project} color={c} />
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              <span>{t("gantt.achievement")}</span>
              <span className="text-[13px] font-bold tabular-nums normal-case tracking-normal" style={{ color: c }}>
                {a.percent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)` }}>
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: open ? `${a.percent}%` : "0%",
                  background: `linear-gradient(180deg, color-mix(in srgb, ${c} 70%, white), ${c})`,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                }}
              />
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{start && end ? `${formatDate(start, locale)} → ${formatDate(end, locale)}` : t("cab.noDates")}</span>
          <span className="flex items-center gap-3">
            {a.basis === "tasks" ? <span>{t("cab.tasks", { done: a.done, total: a.total })}</span> : null}
            {project.status !== "completed" && left !== null ? (
              <span className={cn(late && "font-semibold text-destructive")}>
                {late ? t("gantt.overdue", { n: -left }) : left >= 0 && start && start <= today ? t("gantt.timeLeft", { n: left }) : t("gantt.starts", { n: Math.max(0, days(today, start ?? today)) })}
              </span>
            ) : null}
            <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * One client = one cabinet drawer. Pull it open and its project folders flip up one after the other,
 * each in the project's own color.
 */
export function ClientDrawer({
  client,
  jobs,
  tasks,
  open,
  onToggle,
  noProjects,
}: {
  client: Client;
  jobs: Project[];
  tasks: TaskLite[];
  open: boolean;
  onToggle: () => void;
  noProjects: string;
}) {
  const { t } = useI18n();
  const running = jobs.filter((j) => j.status !== "completed");
  const overall = running.length ? Math.round(running.reduce((s, j) => s + projectAchievement(j, tasks).percent, 0) / running.length) : 0;
  return (
    <section className={cn("frx-drawer", open && "frx-drawer-open")}>
      <div className="frx-drawer-front frx-glass border border-[color:var(--glass-edge)]">
        <div className="flex items-center gap-2 pr-2">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left">
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300", !open && "-rotate-90")} />
            {/* label plate */}
            <span className="min-w-0 rounded-md border border-border/70 bg-background/60 px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]">
              <span className="block truncate font-display text-lg leading-tight tracking-wide">{client.company_name}</span>
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              {jobs.slice(0, 10).map((j) => (
                <span key={j.id} className="size-2.5 rounded-full" style={{ background: projectColor(j), boxShadow: `0 0 0 2px color-mix(in srgb, ${projectColor(j)} 25%, transparent)` }} />
              ))}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span>{t("sp.projectCount", { n: jobs.length })}</span>
              {running.length > 0 ? <span className="font-semibold tabular-nums text-foreground">{overall}%</span> : null}
            </span>
          </button>
          <Link to={`/clients/${client.id}`} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            {t("dash.viewAll")}
            <ChevronRight className="size-3.5" />
          </Link>
          {/* the drawer handle */}
          <span className="hidden h-2 w-14 rounded-full bg-gradient-to-b from-foreground/25 to-foreground/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_2px_3px_rgba(0,0,0,0.25)] sm:block" aria-hidden />
        </div>
      </div>

      <div className="frx-drawer-body">
        <div className="min-h-0 overflow-hidden">
          <div className="frx-drawer-inside">
            {jobs.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{noProjects}</p>
            ) : (
              <div className="grid gap-x-4 gap-y-5 pt-2 lg:grid-cols-2">
                {jobs.map((job, i) => (
                  <ProjectFolder key={job.id} project={job} tasks={tasks} index={i} open={open} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
