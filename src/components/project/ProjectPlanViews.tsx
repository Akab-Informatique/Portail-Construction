import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, FolderKanban, Plus } from "lucide-react";
import { schema } from "../../db";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { DOC_CATEGORIES } from "@/lib/constants";
import type { User } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type EventRow = typeof schema.calendar_events.$inferSelect;
type TaskRow = typeof schema.project_tasks.$inferSelect;
type RfiRow = typeof schema.rfis.$inferSelect;
type PunchRow = typeof schema.punch_items.$inferSelect;
type DocRow = typeof schema.documents.$inferSelect;
type DeadlineItem = { id: string; date: string; title: string; kind: string };

export function CalendarSection({
  events,
  tasks,
  rfis,
  punch,
  canCreate,
  onAdd,
}: {
  events: EventRow[];
  tasks: TaskRow[];
  rfis: RfiRow[];
  punch: PunchRow[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  const { t, locale } = useI18n();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayISO());

  const items = useMemo<DeadlineItem[]>(() => {
    const list: DeadlineItem[] = events.map((e) => ({
      id: `e-${e.id}`,
      date: e.event_date,
      title: e.title,
      kind: e.event_type,
    }));
    tasks.forEach((task) => {
      if (task.end_date) list.push({ id: `t-${task.id}`, date: task.end_date, title: task.title, kind: "task" });
    });
    rfis.forEach((r) => {
      if (r.due_date) list.push({ id: `r-${r.id}`, date: r.due_date, title: `${r.number} · ${r.title}`, kind: "rfi" });
    });
    punch.forEach((p) => {
      if (p.due_date) list.push({ id: `p-${p.id}`, date: p.due_date, title: p.title, kind: "punch" });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [events, tasks, rfis, punch]);

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
  const dayItems = items.filter((item) => item.date === selected);
  const upcoming = items.filter((item) => item.date >= today).slice(0, 8);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">{t("project.nav.calendar")}</h2>
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
          {canCreate ? (
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-4" />
              {t("project.addEvent")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
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
              const marks = items.filter((item) => item.date === key);
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
                  <div className={cn("text-[11px] tabular-nums", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>{day}</div>
                  {marks.slice(0, 2).map((e) => (
                    <div key={e.id} className="mt-0.5 truncate rounded bg-primary/12 px-1 text-[10px] text-primary">
                      {e.title}
                    </div>
                  ))}
                  {marks.length > 2 ? <div className="mt-0.5 text-[10px] text-muted-foreground">+{marks.length - 2}</div> : null}
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
                  <li key={item.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0 font-medium">{item.title}</span>
                    <StatusBadge value={item.kind} />
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
                    <p className="text-xs tabular-nums text-muted-foreground">{formatDate(item.date, locale)}</p>
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

function daysBetween(a: string, b: string) {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

export function ScheduleSection({
  tasks,
  people,
  canCreate,
  onAdd,
}: {
  tasks: TaskRow[];
  people: User[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const dated = tasks.filter((task) => task.start_date || task.end_date);
  const min = dated.reduce((acc, task) => {
    const d = task.start_date || task.end_date || acc;
    return d < acc ? d : acc;
  }, today);
  const max = dated.reduce((acc, task) => {
    const d = task.end_date || task.start_date || acc;
    return d > acc ? d : acc;
  }, today);
  const span = Math.max(daysBetween(min, max), 14);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">{t("project.nav.schedule")}</h2>
        {canCreate ? (
          <Button size="sm" onClick={onAdd}>
            <Plus className="size-4" />
            {t("project.addEvent")}
          </Button>
        ) : null}
      </div>
      <Card className="mb-5 gap-3 overflow-hidden p-4">
        <div>
          <p className="text-sm font-medium">{t("project.gantt.title")}</p>
        </div>
        {dated.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("project.gantt.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px] space-y-2">
              {dated.map((task) => {
                const start = task.start_date || task.end_date || min;
                const end = task.end_date || task.start_date || start;
                const offset =
                  ((new Date(`${start}T00:00:00`).getTime() - new Date(`${min}T00:00:00`).getTime()) / 86400000 / span) * 100;
                const width = (daysBetween(start, end) / span) * 100;
                const late = Boolean(task.end_date && task.end_date < today && task.status !== "done" && task.status !== "complete");
                return (
                  <div key={task.id} className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-3">
                    <p className="truncate text-sm">{task.title}</p>
                    <div className="relative h-8 rounded-md bg-muted/50">
                      <div
                        className={cn("absolute top-1.5 h-5 rounded-sm", late ? "bg-destructive/80" : "bg-primary/80")}
                        style={{ left: `${Math.max(offset, 0)}%`, width: `${Math.min(Math.max(width, 4), 100)}%` }}
                        title={`${formatDate(start, locale)} → ${formatDate(end, locale)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
      <h3 className="mb-3 text-sm font-medium">{t("project.gantt.list")}</h3>
      {tasks.length === 0 ? (
        <EmptyState icon={<FolderKanban className="size-5" />} title={t("project.scheduleEmpty")} description="" />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {tasks.map((task) => {
            const owner = people.find((p) => p.id === task.assigned_to);
            return (
              <li key={task.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(task.start_date, locale)} → {formatDate(task.end_date, locale)}
                    {owner ? ` · ${owner.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={task.status} />
                  <span className="text-xs text-muted-foreground">{task.priority}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DocumentsSection({
  docs,
  canCreate,
  onAdd,
}: {
  docs: DocRow[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState("all");
  const filtered = category === "all" ? docs : docs.filter((d) => d.category === category);
  const counts = DOC_CATEGORIES.map((c) => ({ cat: c, n: docs.filter((d) => d.category === c).length }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">{t("project.nav.documents")}</h2>
        {canCreate ? (
          <Button size="sm" onClick={onAdd}>
            <Plus className="size-4" />
            {t("project.addEvent")}
          </Button>
        ) : null}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={category === "all" ? "default" : "outline"} onClick={() => setCategory("all")}>
          {t("project.docs.all")} · {docs.length}
        </Button>
        {counts.map(({ cat, n }) => (
          <Button key={cat} size="sm" variant={category === cat ? "default" : "outline"} onClick={() => setCategory(cat)}>
            {cat} · {n}
          </Button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<FileText className="size-5" />} title={t("project.docs.empty")} description={t("project.docs.count", { n: 0 })} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((d) => (
            <li key={d.id} className="rounded-xl border bg-card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="font-medium">{d.name}</p>
                <StatusBadge value={d.category.toLowerCase().replace(/\s+/g, "_")} />
              </div>
              <p className="text-xs text-muted-foreground">{d.notes || d.category}</p>
              <p className="mt-2 text-xs tabular-nums text-muted-foreground">{formatDate(d.created_at, locale)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
