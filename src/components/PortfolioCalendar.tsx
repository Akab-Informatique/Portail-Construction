import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

export type CalendarMark = {
  id: string;
  date: string;
  title: string;
  kind: string;
  projectId: number;
  projectName: string;
};

export function marksFromPortfolio(
  projects: Project[],
  events: { id: number; event_date: string; title: string; event_type: string; project_id: number }[],
  tasks: { id: number; end_date: string | null; title: string; project_id: number }[],
  rfis: { id: number; due_date: string | null; number: string; title: string; project_id: number }[],
  punch: { id: number; due_date: string | null; title: string; project_id: number }[],
): CalendarMark[] {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const list: CalendarMark[] = [];
  events.forEach((e) => {
    list.push({
      id: `e-${e.id}`,
      date: e.event_date,
      title: e.title,
      kind: e.event_type,
      projectId: e.project_id,
      projectName: names.get(e.project_id) ?? "",
    });
  });
  tasks.forEach((task) => {
    if (!task.end_date) return;
    list.push({
      id: `t-${task.id}`,
      date: task.end_date,
      title: task.title,
      kind: "task",
      projectId: task.project_id,
      projectName: names.get(task.project_id) ?? "",
    });
  });
  rfis.forEach((r) => {
    if (!r.due_date) return;
    list.push({
      id: `r-${r.id}`,
      date: r.due_date,
      title: `${r.number} · ${r.title}`,
      kind: "rfi",
      projectId: r.project_id,
      projectName: names.get(r.project_id) ?? "",
    });
  });
  punch.forEach((p) => {
    if (!p.due_date) return;
    list.push({
      id: `p-${p.id}`,
      date: p.due_date,
      title: p.title,
      kind: "punch",
      projectId: p.project_id,
      projectName: names.get(p.project_id) ?? "",
    });
  });
  projects.forEach((p) => {
    if (p.start_date) {
      list.push({
        id: `ps-${p.id}`,
        date: p.start_date,
        title: p.name,
        kind: "start",
        projectId: p.id,
        projectName: p.name,
      });
    }
    if (p.end_date) {
      list.push({
        id: `pe-${p.id}`,
        date: p.end_date,
        title: p.name,
        kind: "milestone",
        projectId: p.id,
        projectName: p.name,
      });
    }
  });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

export function PortfolioCalendar({
  marks,
  title,
}: {
  marks: CalendarMark[];
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
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const iso = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const today = todayISO();
  const dayItems = marks.filter((item) => item.date === selected);
  const upcoming = marks.filter((item) => item.date >= today).slice(0, 8);

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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.8fr)]">
        <div>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
            {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((d) => (
              <div key={d} className="py-1">
                {t(`cal.${d}`)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="min-h-16" />;
              const key = iso(day);
              const dayMarks = marks.filter((item) => item.date === key);
              const isSel = key === selected;
              const isToday = key === today;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={cn(
                    "min-h-16 rounded-md border p-1 text-left transition-colors",
                    isSel ? "border-primary bg-primary/8" : "bg-card hover:bg-muted/40",
                    isToday && !isSel && "border-primary/40",
                  )}
                >
                  <div className={cn("text-[11px] tabular-nums", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                    {day}
                  </div>
                  {dayMarks.slice(0, 2).map((e) => (
                    <div key={e.id} className="mt-0.5 truncate rounded bg-primary/12 px-1 text-[10px] text-primary">
                      {e.title}
                    </div>
                  ))}
                  {dayMarks.length > 2 ? <div className="mt-0.5 text-[10px] text-muted-foreground">+{dayMarks.length - 2}</div> : null}
                </button>
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
                      <span className="min-w-0">
                        <span className="block font-medium">{item.title}</span>
                        <span className="block text-xs text-muted-foreground">{item.projectName}</span>
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
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatDate(item.date, locale)} · {item.projectName}
                    </p>
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

export function PortfolioGantt({ projects }: { projects: Project[] }) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const dated = useMemo(
    () => projects.filter((p) => p.start_date || p.end_date),
    [projects],
  );
  const min = dated.reduce((acc, p) => {
    const d = p.start_date || p.end_date || acc;
    return d < acc ? d : acc;
  }, today);
  const max = dated.reduce((acc, p) => {
    const d = p.end_date || p.start_date || acc;
    return d > acc ? d : acc;
  }, today);
  const span = Math.max(daysBetween(min, max), 14);

  return (
    <Card className="gap-3 overflow-hidden p-4">
      <div>
        <p className="text-sm font-medium">{t("dash.gantt")}</p>
      </div>
      {dated.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("project.gantt.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px] space-y-2">
            {dated.map((project) => {
              const start = project.start_date || project.end_date || min;
              const end = project.end_date || project.start_date || start;
              const offset =
                ((new Date(`${start}T00:00:00`).getTime() - new Date(`${min}T00:00:00`).getTime()) / 86400000 / span) * 100;
              const width = (daysBetween(start, end) / span) * 100;
              const late = Boolean(project.end_date && project.end_date < today && project.status !== "complete");
              return (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-3"
                >
                  <p className="truncate text-sm">{project.name}</p>
                  <div className="relative h-8 rounded-md bg-muted/50">
                    <div
                      className={cn("absolute top-1.5 h-5 rounded-sm", late ? "bg-destructive/80" : "bg-primary/80")}
                      style={{ left: `${Math.max(offset, 0)}%`, width: `${Math.min(Math.max(width, 4), 100)}%` }}
                      title={`${formatDate(start, locale)} → ${formatDate(end, locale)}`}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function daysBetween(a: string, b: string) {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}
