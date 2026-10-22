import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { formatDate, todayISO } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { projectColor } from "@/lib/project-colors";
import { projectAchievement, scheduleElapsed, type TaskLite } from "@/lib/project-progress";
import { cn } from "@/lib/utils";
import type { Client, Project } from "@/lib/types";

const DAY = 86400000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const addDays = (iso: string, n: number) => new Date(at(iso) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);
const LABEL_W = 270;
const ZOOM_PX = 9;

/**
 * Portfolio timeline: one bar per project in its own color, with dates, duration and
 * achievement printed on the row. Click a row for the rest of the details.
 */
export function PortfolioGantt({ projects, clients = [], tasks = [] }: { projects: Project[]; clients?: Client[]; tasks?: TaskLite[] }) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const [zoom, setZoom] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      projects
        .filter((p) => p.start_date || p.end_date)
        .map((p) => {
          let start = (p.start_date || p.end_date)!;
          let end = (p.end_date || p.start_date)!;
          if (end < start) [start, end] = [end, start];
          return { project: p, start, end, ...projectAchievement(p, tasks) };
        })
        .sort((a, b) => a.start.localeCompare(b.start)),
    [projects, tasks],
  );

  if (rows.length === 0) {
    return (
      <Card className="gap-3 p-4">
        <p className="text-sm font-medium">{t("dash.gantt")}</p>
        <p className="py-8 text-center text-sm text-muted-foreground">{t("project.gantt.empty")}</p>
      </Card>
    );
  }

  const min = addDays(rows.reduce((m, r) => (r.start < m ? r.start : m), today), -7);
  const max = addDays(rows.reduce((m, r) => (r.end > m ? r.end : m), today), 14);
  const span = Math.max(daysBetween(min, max), 30);
  const pct = (iso: string) => (daysBetween(min, iso) / span) * 100;

  // Month marks across the top.
  const months: { label: string; left: number }[] = [];
  for (let d = new Date(`${min.slice(0, 7)}-01T00:00:00`); d.getTime() <= at(max); d.setMonth(d.getMonth() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    if (iso < min) continue;
    months.push({ label: d.toLocaleDateString(locale, { month: "short", year: "2-digit" }), left: pct(iso) });
  }
  const monthStep = Math.max(1, Math.ceil(months.length / (zoom ? 40 : 8)));
  const shownMonths = months.filter((_, i) => i % monthStep === 0);
  const todayLeft = pct(today);

  return (
    <Card className="gap-3 overflow-hidden p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("dash.gantt")}</p>
        <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
          {[
            [false, t("gantt.zoomFit")],
            [true, t("gantt.zoomDetail")],
          ].map(([value, label]) => (
            <Button key={String(label)} type="button" size="sm" variant={zoom === value ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setZoom(Boolean(value))}>
              {label as string}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: zoom ? LABEL_W + span * ZOOM_PX : 760 }}>
          {/* header */}
          <div className="grid items-end border-b pb-1.5" style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) 92px` }}>
            <span className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("nav.projects")}</span>
            <div className="relative h-5">
              {shownMonths.map((m) => (
                <span key={m.left} className="absolute text-[11px] font-medium capitalize text-muted-foreground" style={{ left: `${m.left}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
            <span className="text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">%</span>
          </div>

          {rows.map(({ project, start, end, percent, done, total, basis }) => {
            const c = projectColor(project);
            const left = pct(start);
            const width = Math.max(pct(addDays(end, 1)) - left, 1.5);
            const elapsed = scheduleElapsed(start, end, today);
            const duration = daysBetween(start, end) + 1;
            const late = end < today && project.status !== "completed";
            const daysLeft = daysBetween(today, end);
            const open = openId === project.id;
            const client = clients.find((x) => x.id === project.client_id);
            const rightAligned = left + width > 62;
            return (
              <Fragment key={project.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(open ? null : project.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenId(open ? null : project.id)}
                  className={cn("grid cursor-pointer items-center border-b border-border/50 transition-colors hover:bg-primary/5", open && "bg-primary/5")}
                  style={{ gridTemplateColumns: `${LABEL_W}px minmax(0,1fr) 92px` }}
                >
                  <div className="flex min-w-0 items-center gap-2 px-2 py-3">
                    <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                    <span className="size-3 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 0 3px color-mix(in srgb, ${c} 25%, transparent)` }} />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-tight">{project.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{client?.company_name ?? project.project_number}</p>
                    </div>
                  </div>

                  <div className="relative h-14">
                    {todayLeft >= 0 && todayLeft <= 100 ? <span className="absolute inset-y-0 w-px bg-primary/60" style={{ left: `${todayLeft}%` }} /> : null}
                    {/* bar: full duration in a soft tint, achievement filled in the project color */}
                    <div
                      className="absolute top-2.5 h-6 overflow-hidden rounded-full"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: `color-mix(in srgb, ${c} 22%, transparent)`,
                        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 45%, transparent), 0 4px 10px -6px ${c}`,
                      }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${percent}%`,
                          background: `linear-gradient(180deg, color-mix(in srgb, ${c} 75%, white), ${c} 55%, color-mix(in srgb, ${c} 82%, black))`,
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                        }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-foreground [text-shadow:0_0_4px_var(--card),0_0_2px_var(--card)]">{percent}%</span>
                    </div>
                    <p
                      className="absolute top-9 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
                      style={rightAligned ? { right: `${100 - left - width}%` } : { left: `${left}%` }}
                    >
                      {formatDate(start, locale)} → {formatDate(end, locale)} · {t("gantt.duration", { n: duration })}
                    </p>
                  </div>

                  <div className="pr-2 text-right">
                    <p className="font-display text-xl leading-none" style={{ color: c }}>
                      {percent}%
                    </p>
                    <p className={cn("mt-0.5 text-[10px]", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {late ? t("gantt.overdue", { n: -daysLeft }) : project.status === "completed" ? "" : daysLeft >= 0 && start <= today ? t("gantt.timeLeft", { n: daysLeft }) : t("gantt.starts", { n: daysBetween(today, start) })}
                    </p>
                  </div>
                </div>

                {open ? (
                  <div
                    className="grid gap-x-6 gap-y-3 border-b px-4 py-4 sm:grid-cols-2 lg:grid-cols-4"
                    style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${c} 10%, transparent), transparent 80%)`, boxShadow: `inset 3px 0 0 ${c}` }}
                  >
                    <Detail label={t("gantt.client")} value={client?.company_name ?? "—"} />
                    <Detail label={t("gantt.number")} value={project.project_number} />
                    <Detail label={t("gantt.phase")} value={project.phase ? project.phase.replace(/_/g, " ") : "—"} capitalize />
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{t("project.status")}</p>
                      <div className="mt-1">
                        <StatusBadge value={project.status} />
                      </div>
                    </div>
                    <Detail label={t("gantt.location")} value={[project.address, project.city].filter(Boolean).join(", ") || "—"} />
                    <Detail label={t("gantt.achievement")} value={`${percent}%`} sub={basis === "tasks" ? t("gantt.basisTasks", { done, total }) : basis === "status" ? t("gantt.basisStatus") : t("gantt.basisSchedule")} />
                    <Detail
                      label={t("gantt.schedule")}
                      value={`${elapsed}%`}
                      sub={percent >= elapsed ? t("gantt.onTrack") : t("gantt.behind", { n: elapsed - percent })}
                    />
                    <div className="flex items-end">
                      <Button asChild size="sm">
                        <Link to={`/projects/${project.id}`}>
                          {t("gantt.open")}
                          <ArrowUpRight className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function Detail({ label, value, sub, capitalize }: { label: string; value: string; sub?: string; capitalize?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm font-medium", capitalize && "capitalize")}>{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
