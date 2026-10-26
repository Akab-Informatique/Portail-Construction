import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { eq } from "drizzle-orm";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { formatDate, todayISO } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { loadPrefs, personalCall, type OutlookEvent } from "@/lib/user-prefs";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OUTLOOK = "#0f6cbd";
const LANES = 4;

type Item = {
  key: string;
  title: string;
  /** First and last day it covers, YYYY-MM-DD. */
  start: string;
  end: string;
  color: string;
  kind: "task" | "outlook";
  time?: string;
  where?: string;
  done?: boolean;
  projectId?: number;
  project?: string;
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

/**
 * The employee's own calendar: every project task assigned to them, plus their Outlook (Microsoft 365) events when
 * they switched it on in their profile. It shows only what belongs to this person.
 */
export function MyCalendarPage() {
  const { t, locale } = useI18n();
  const { user, realUser } = useAuth();
  const { projects } = useWorkspace();
  const navigate = useNavigate();
  const me = realUser?.id ?? user?.id;
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState(todayISO());
  const [tasks, setTasks] = useState<(typeof schema.project_tasks.$inferSelect)[]>([]);
  const [events, setEvents] = useState<OutlookEvent[]>([]);
  const [outlookOn, setOutlookOn] = useState<boolean | null>(null);
  const [outlookError, setOutlookError] = useState<string | null>(null);

  // the six weeks shown, Monday first
  const gridStart = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    first.setDate(first.getDate() - offset);
    return iso(first);
  }, [month]);
  const gridEnd = addDays(gridStart, 41);

  useEffect(() => {
    if (!me) return;
    void dbReady.then(async () => {
      setTasks(await db.select().from(schema.project_tasks).where(eq(schema.project_tasks.assigned_to, me)));
    });
  }, [me]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    void loadPrefs(me).then(async (prefs) => {
      if (cancelled) return;
      setOutlookOn(Boolean(prefs.o365_calendar));
      if (!prefs.o365_calendar) return setEvents([]);
      const result = await personalCall({ action: "calendar", from: gridStart, to: gridEnd });
      if (cancelled) return;
      if (result.error) setOutlookError(result.error);
      else setOutlookError(null);
      setEvents(result.events ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [me, gridStart, gridEnd]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const task of tasks) {
      if (task.kind !== "task") continue;
      const start = task.start_date || task.end_date;
      const end = task.end_date || task.start_date;
      if (!start || !end) continue;
      const project = projects.find((p) => p.id === task.project_id);
      out.push({
        key: `t${task.id}`,
        title: task.title,
        start: start <= end ? start : end,
        end: start <= end ? end : start,
        color: project ? projectColor(project) : "var(--primary)",
        kind: "task",
        done: task.status === "completed",
        projectId: task.project_id,
        project: project?.name,
      });
    }
    for (const e of events) {
      const start = e.start.slice(0, 10);
      const end = e.end.slice(0, 10) || start;
      out.push({ key: `o${e.id}`, title: e.title || "—", start, end: end < start ? start : end, color: OUTLOOK, kind: "outlook", time: e.allDay ? undefined : `${e.start.slice(11)}`, where: e.location });
    }
    return out.filter((i) => i.end >= gridStart && i.start <= gridEnd).sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.key.localeCompare(b.key));
  }, [tasks, events, projects, gridStart, gridEnd]);

  const weeks = useMemo(() => {
    return Array.from({ length: 6 }, (_, w) => {
      const ws = addDays(gridStart, w * 7);
      const we = addDays(ws, 6);
      const laneEnd: string[] = [];
      const placed: { item: Item; col: number; span: number; lane: number }[] = [];
      for (const item of items) {
        if (item.end < ws || item.start > we) continue;
        const s = item.start < ws ? ws : item.start;
        const e = item.end > we ? we : item.end;
        let lane = laneEnd.findIndex((end) => end < s);
        if (lane === -1) lane = laneEnd.length;
        laneEnd[lane] = e;
        const col = Math.round((parse(s).getTime() - parse(ws).getTime()) / 86400000);
        const span = Math.round((parse(e).getTime() - parse(s).getTime()) / 86400000) + 1;
        placed.push({ item, col, span, lane });
      }
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
      const hidden = days.map((d) => placed.filter((p) => p.lane >= LANES && p.item.start <= d && p.item.end >= d).length);
      return { ws, days, placed: placed.filter((p) => p.lane < LANES), hidden, lanes: Math.min(LANES, laneEnd.length) };
    });
  }, [items, gridStart]);

  const today = todayISO();
  const dayItems = items.filter((i) => i.start <= day && i.end >= day);
  const monthLabel = new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", { month: "long", year: "numeric" }).format(month);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", { weekday: "short" }).format(parse(addDays(gridStart, i)))), [gridStart, locale]);
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.section.client")}
        title={t("nav.myCalendar")}
        actions={
          <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1">
            <Button size="icon-sm" variant="ghost" aria-label="‹" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold capitalize">{monthLabel}</span>
            <Button size="icon-sm" variant="ghost" aria-label="›" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const d = new Date();
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                setDay(todayISO());
              }}
            >
              {t("cal.today")}
            </Button>
          </div>
        }
      />

      {outlookOn === false ? (
        <p className="mb-4 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {t("cal.outlookOff")}{" "}
          <Link to="/profile" className="font-medium text-foreground underline underline-offset-2">
            {t("nav.profile")}
          </Link>
        </p>
      ) : null}
      {outlookError ? <p className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{t("cal.outlookError", { m: outlookError })}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {weekdays.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week.ws} className="relative border-b last:border-b-0" style={{ minHeight: 30 + week.lanes * 22 + 24 }}>
              <div className="absolute inset-0 grid grid-cols-7">
                {week.days.map((d, i) => {
                  const inMonth = parse(d).getMonth() === month.getMonth();
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDay(d)}
                      className={cn("relative border-r px-1.5 pt-1 text-left text-xs transition-colors last:border-r-0 hover:bg-foreground/5", !inMonth && "bg-muted/30 text-muted-foreground", d === day && "bg-foreground/5")}
                      aria-label={d}
                      aria-pressed={d === day}
                    >
                      <span className={cn("inline-flex size-5 items-center justify-center rounded-full font-medium", d === today && "bg-primary text-primary-foreground")}>{parse(d).getDate()}</span>
                      {week.hidden[i] ? <span className="absolute right-1 bottom-0.5 text-[10px] text-muted-foreground">{t("cal.more", { n: week.hidden[i] })}</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none relative grid grid-cols-7 gap-y-0.5 px-0.5 pt-7">
                {week.placed.map(({ item, col, span, lane }) => (
                  <button
                    key={`${item.key}-${week.ws}`}
                    type="button"
                    onClick={() => (item.kind === "task" && item.projectId ? navigate(`/projects/${item.projectId}/tasks`) : setDay(item.start < week.ws ? week.ws : item.start))}
                    title={[item.time, item.title, item.project, item.where].filter(Boolean).join(" · ")}
                    className={cn("pointer-events-auto flex h-5 items-center gap-1 truncate rounded px-1.5 text-left text-[11px] font-medium leading-none text-foreground", item.done && "opacity-50 line-through")}
                    style={{
                      gridColumn: `${col + 1} / span ${span}`,
                      gridRow: lane + 1,
                      background: `color-mix(in srgb, ${item.color} 28%, var(--card))`,
                      boxShadow: `inset 3px 0 0 ${item.color}`,
                    }}
                  >
                    {item.time ? <span className="shrink-0 tabular-nums text-muted-foreground">{item.time}</span> : null}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>

        <Card className="h-fit gap-3 p-5">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            <h2 className="font-display text-lg tracking-wide">{formatDate(day, locale)}</h2>
          </div>
          {dayItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cal.nothing")}</p>
          ) : (
            <ul className="space-y-2">
              {dayItems.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => i.kind === "task" && i.projectId && navigate(`/projects/${i.projectId}/tasks`)}
                    className={cn("block w-full rounded-lg border px-3 py-2 text-left transition-colors", i.kind === "task" && "hover:bg-foreground/5", i.done && "opacity-60")}
                    style={{ boxShadow: `inset 3px 0 0 ${i.color}` }}
                  >
                    <span className={cn("block text-sm font-medium", i.done && "line-through")}>{i.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{i.kind === "outlook" ? `${t("cal.outlook")} · ${i.time ?? t("cal.allDay")}` : i.project}</span>
                      {i.end > i.start ? <span>{t("cal.until", { d: formatDate(i.end, locale) })}</span> : null}
                      {i.where ? (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="size-3" />
                          {i.where}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary" />
              {t("cal.tasks")}
            </span>
            {outlookOn ? (
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: OUTLOOK }} />
                {t("cal.outlook")}
              </span>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
