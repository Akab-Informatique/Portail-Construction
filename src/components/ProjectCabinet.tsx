import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Star } from "lucide-react";
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

function useOverall(jobs: Project[], tasks: TaskLite[]) {
  const running = jobs.filter((j) => j.status !== "completed");
  const overall = running.length ? Math.round(running.reduce((sum, j) => sum + projectAchievement(j, tasks).percent, 0) / running.length) : 0;
  return { running: running.length, overall };
}

/** One drawer of the cabinet: a metal front with a label holder and a pull. The chosen one is slid out. */
export function ClientTab({
  client,
  jobs,
  tasks,
  selected,
  onSelect,
  favorite,
  onToggleFavorite,
}: {
  client: Client;
  jobs: Project[];
  tasks: TaskLite[];
  selected: boolean;
  onSelect: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const { t } = useI18n();
  const { running, overall } = useOverall(jobs, tasks);
  return (
    <div className="frx-slot">
      <div className={cn("frx-face", selected && "frx-face-out")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="block w-full text-left">
        <span className="frx-label-holder mr-6">
          <span className="block truncate font-display text-[15px] leading-tight tracking-wide">{client.company_name}</span>
        </span>
        <span className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
          <span className="flex items-center gap-1">
            {jobs.slice(0, 8).map((j) => (
              <span key={j.id} className="size-2 rounded-full" style={{ background: projectColor(j), boxShadow: `0 0 0 1.5px color-mix(in srgb, ${projectColor(j)} 30%, transparent)` }} />
            ))}
          </span>
          <span className="flex items-center gap-2">
            <span>{t("sp.projectCount", { n: jobs.length })}</span>
            {running > 0 ? <span className="font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">{overall}%</span> : null}
          </span>
        </span>
        <span className="frx-pull" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? t("cab.unpin") : t("cab.pin")}
        title={favorite ? t("cab.unpin") : t("cab.pin")}
        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-black/10 hover:text-amber-500"
      >
        <Star className={cn("size-4", favorite && "fill-amber-400 text-amber-500")} />
      </button>
      </div>
    </div>
  );
}

/** One section of the drawer: running jobs, or the archive of finished ones. */
function FolderSection({
  title,
  jobs,
  tasks,
  open,
  startIndex,
  collapsible,
}: {
  title: string;
  jobs: Project[];
  tasks: TaskLite[];
  open: boolean;
  startIndex: number;
  collapsible?: boolean;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(true);
  if (jobs.length === 0 && collapsible) return null;
  const expanded = !collapsible || shown;
  return (
    <section>
      <button
        type="button"
        onClick={() => collapsible && setShown((v) => !v)}
        aria-expanded={expanded}
        className={cn("mb-3 flex w-full items-center gap-2 text-left", collapsible ? "cursor-pointer" : "cursor-default")}
      >
        {collapsible ? <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !shown && "-rotate-90")} /> : null}
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</span>
        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground dark:bg-white/10">{jobs.length}</span>
        <span className="h-px flex-1 bg-border/70" aria-hidden />
      </button>
      {expanded ? (
        jobs.length === 0 ? (
          <p className="pb-1 text-sm text-muted-foreground">{t("cab.noneHere")}</p>
        ) : (
          <div className={cn("grid gap-x-4 gap-y-6 pt-2 xl:grid-cols-2", collapsible && "opacity-80 saturate-75")}>
            {jobs.map((job, i) => (
              <ProjectFolder key={job.id} project={job} tasks={tasks} index={startIndex + i} open={open} />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

/** The open drawer: the client's projects laid out as folders you can flip through. */
export function ClientFolders({ client, jobs, tasks, noProjects }: { client: Client; jobs: Project[]; tasks: TaskLite[]; noProjects: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { running, overall } = useOverall(jobs, tasks);
  const active = jobs.filter((j) => j.status !== "completed");
  const archived = jobs.filter((j) => j.status === "completed");
  // Mount closed, then open, so the folders flip up every time another drawer is chosen.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="frx-drawer-open">
      <div className="frx-glass mb-3 flex flex-wrap items-center justify-between gap-3 border border-[color:var(--glass-edge)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-xl leading-tight tracking-wide">{client.company_name}</p>
          <p className="text-xs text-muted-foreground">
            {t("sp.projectCount", { n: jobs.length })}
            {running > 0 ? ` · ${overall}% ${t("gantt.achievement").toLowerCase()}` : ""}
          </p>
        </div>
        <Link to={`/clients/${client.id}`} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60">
          {t("cab.clientPage")}
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
      <div className="frx-drawer-inside" style={{ borderRadius: "var(--radius-xl)", marginTop: 0 }}>
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{noProjects}</p>
        ) : (
          <div className="space-y-7">
            <FolderSection title={t("cab.active")} jobs={active} tasks={tasks} open={open} startIndex={0} />
            <FolderSection title={t("cab.archived")} jobs={archived} tasks={tasks} open={open} startIndex={active.length} collapsible />
          </div>
        )}
      </div>
    </div>
  );
}
