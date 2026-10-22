import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { projectColor } from "@/lib/project-colors";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

export type CalendarMark = {
  id: string;
  date: string;
  title: string;
  kind: string;
  projectId: number;
  projectName: string;
  color: string;
};

export function marksFromPortfolio(
  projects: Project[],
  events: { id: number; event_date: string; title: string; event_type: string; project_id: number }[],
  tasks: { id: number; end_date: string | null; title: string; project_id: number }[],
  rfis: { id: number; due_date: string | null; number: string; title: string; project_id: number }[],
  punch: { id: number; due_date: string | null; title: string; project_id: number }[],
): CalendarMark[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const info = (id: number) => ({ projectName: byId.get(id)?.name ?? "", color: byId.get(id) ? projectColor(byId.get(id)!) : projectColor({}) });
  const list: CalendarMark[] = [];
  events.forEach((e) => {
    list.push({ id: `e-${e.id}`, date: e.event_date, title: e.title, kind: e.event_type, projectId: e.project_id, ...info(e.project_id) });
  });
  tasks.forEach((task) => {
    if (!task.end_date) return;
    list.push({ id: `t-${task.id}`, date: task.end_date, title: task.title, kind: "task", projectId: task.project_id, ...info(task.project_id) });
  });
  rfis.forEach((r) => {
    if (!r.due_date) return;
    list.push({ id: `r-${r.id}`, date: r.due_date, title: `${r.number} · ${r.title}`, kind: "rfi", projectId: r.project_id, ...info(r.project_id) });
  });
  punch.forEach((p) => {
    if (!p.due_date) return;
    list.push({ id: `p-${p.id}`, date: p.due_date, title: p.title, kind: "punch", projectId: p.project_id, ...info(p.project_id) });
  });
  projects.forEach((p) => {
    if (p.start_date) list.push({ id: `ps-${p.id}`, date: p.start_date, title: p.name, kind: "start", projectId: p.id, ...info(p.id) });
    if (p.end_date) list.push({ id: `pe-${p.id}`, date: p.end_date, title: p.name, kind: "milestone", projectId: p.id, ...info(p.id) });
  });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const LANE = 20;
const BAR_TOP = 22;

type Segment = { project: Project; s: number; e: number; lane: number; startsHere: boolean; endsHere: boolean };

/** One continuous bar per project per week, stacked in lanes so they never overlap. */
function weekSegments(projects: Project[], days: string[]): { segments: Segment[]; lanes: number } {
  const first = days[0];
  const last = days[6];
  const raw: Omit<Segment, "lane">[] = [];
  for (const project of projects) {
    let a = project.start_date || project.end_date;
    let b = project.end_date || project.start_date;
    if (!a || !b) continue;
    if (b < a) [a, b] = [b, a];
    if (b < first || a > last) continue;
    const s = a <= first ? 0 : days.indexOf(a);
    const e = b >= last ? 6 : days.indexOf(b);
    raw.push({ project, s, e, startsHere: a >= first, endsHere: b <= last });
  }
  raw.sort((x, y) => x.s - y.s || y.e - x.e || x.project.id - y.project.id);
  const laneEnds: number[] = [];
  const segments = raw.map((seg) => {
    let lane = laneEnds.findIndex((end) => end < seg.s);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = seg.e;
    return { ...seg, lane };
  });
  return { segments, lanes: laneEnds.length };
}

export function PortfolioCalendar({
  marks,
  projects = [],
  title,
}: {
  marks: CalendarMark[];
  projects?: Project[];
  title?: string;
}) {
  const { t, locale } = useI18n();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayISO());

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const today = todayISO();

  // Whole weeks, so a bar can run straight through the month edges.
  const weeks = useMemo(() => {
    const lead = new Date(year, month, 1).getDay();
    const count = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7);
    return Array.from({ length: count }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => isoOf(new Date(year, month, 1 - lead + w * 7 + d))),
    );
  }, [year, month]);

  const chipMarks = useMemo(() => marks.filter((m) => m.kind !== "start" && m.kind !== "milestone"), [marks]);
  const dayItems = marks.filter((item) => item.date === selected);
  const upcoming = marks.filter((item) => item.date >= today).slice(0, 8);
  const legend = projects.filter((p) => p.start_date || p.end_date);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">{title ?? t("dash.calendar")}</h2>
          <p className="text-sm text-muted-foreground">{formatMonth(cursor, locale)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label={t("project.cal.prev")} onClick={() => setCursor(new Date(year, month - 1, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const n = new Date();
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
              setSelected(todayISO());
            }}
          >
            {t("project.cal.today")}
          </Button>
          <Button variant="outline" size="icon-sm" aria-label={t("project.cal.next")} onClick={() => setCursor(new Date(year, month + 1, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {legend.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <span className="size-2.5 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.5)]" style={{ background: projectColor(p) }} />
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(240px,0.8fr)]">
        <div>
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((d) => (
              <div key={d} className="py-1">
                {t(`cal.${d}`)}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((days) => {
              const { segments, lanes } = weekSegments(projects, days);
              return (
                <div key={days[0]} className="relative">
                  <div className="grid grid-cols-7 gap-1">
                    {days.map((key) => {
                      const dayMarks = chipMarks.filter((item) => item.date === key);
                      const inMonth = Number(key.slice(5, 7)) - 1 === month;
                      const isSel = key === selected;
                      const isToday = key === today;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSelected(key)}
                          style={{ minHeight: BAR_TOP + lanes * LANE + 40 }}
                          className={cn(
                            "frx-cell flex flex-col items-stretch justify-start rounded-md border p-1 text-left transition-all",
                            isSel ? "border-primary bg-primary/10 shadow-[0_6px_18px_-8px_var(--primary)]" : "hover:-translate-y-px",
                            isToday && !isSel && "border-primary/50",
                            !inMonth && "opacity-45",
                          )}
                        >
                          <div className={cn("text-[11px] tabular-nums", isToday ? "font-bold text-primary" : "text-muted-foreground")}>{Number(key.slice(8))}</div>
                          <div style={{ marginTop: lanes * LANE + 2 }}>
                            {dayMarks.slice(0, 1).map((e) => (
                              <div
                                key={e.id}
                                className="truncate rounded px-1 text-[10px] font-medium"
                                style={{ background: `color-mix(in srgb, ${e.color} 18%, transparent)`, color: e.color, boxShadow: `inset 2px 0 0 ${e.color}` }}
                              >
                                {e.title}
                              </div>
                            ))}
                            {dayMarks.length > 1 ? <div className="mt-0.5 text-[10px] text-muted-foreground">+{dayMarks.length - 1}</div> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {segments.length > 0 ? (
                    <div className="pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-x-1" style={{ top: BAR_TOP, gridAutoRows: `${LANE - 3}px`, rowGap: 3 }}>
                      {segments.map((seg) => {
                        const c = projectColor(seg.project);
                        return (
                          <Link
                            key={seg.project.id}
                            to={`/projects/${seg.project.id}`}
                            title={`${seg.project.name} · ${formatDate(seg.project.start_date || seg.project.end_date!, locale)} → ${formatDate(seg.project.end_date || seg.project.start_date!, locale)}`}
                            className={cn(
                              "pointer-events-auto flex items-center truncate px-2 text-[10px] font-semibold text-white transition-[filter,transform] hover:z-10 hover:brightness-110",
                              seg.startsHere ? "rounded-l-full" : "rounded-l-none",
                              seg.endsHere ? "rounded-r-full" : "rounded-r-none",
                            )}
                            style={{
                              gridColumn: `${seg.s + 1} / ${seg.e + 2}`,
                              gridRow: seg.lane + 1,
                              background: `linear-gradient(180deg, color-mix(in srgb, ${c} 78%, white), ${c} 55%, color-mix(in srgb, ${c} 85%, black))`,
                              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.45), 0 3px 8px -3px ${c}`,
                              textShadow: "0 1px 1px rgba(0,0,0,0.35)",
                            }}
                          >
                            <span className="truncate">{seg.project.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-4">
          <Card className="gap-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{formatDate(selected, locale)}</p>
            {dayItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("project.cal.emptyDay")}</p>
            ) : (
              <ul className="space-y-2">
                {dayItems.map((item) => (
                  <li key={item.id}>
                    <Link to={`/projects/${item.projectId}`} className="flex items-start justify-between gap-2 text-sm hover:text-primary">
                      <span className="flex min-w-0 items-start gap-2">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: item.color }} />
                        <span className="min-w-0">
                          <span className="block font-medium">{item.title}</span>
                          <span className="block text-xs text-muted-foreground">{item.projectName}</span>
                        </span>
                      </span>
                      <StatusBadge value={item.kind} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="gap-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("project.cal.upcoming")}</p>
            <ul className="space-y-2">
              {upcoming.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: item.color }} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatDate(item.date, locale)} · {item.projectName}
                      </p>
                    </div>
                  </div>
                  <StatusBadge value={item.kind} />
                </li>
              ))}
              {upcoming.length === 0 ? <li className="text-sm text-muted-foreground">{t("project.cal.emptyDay")}</li> : null}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
