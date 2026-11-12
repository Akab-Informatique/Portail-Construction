import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { asc, eq } from "drizzle-orm";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Bookmark, Circle, Copy, FileUp, GanttChartSquare, Pencil, TableProperties, ListChecks, Lock, MessageSquare, Paperclip, Plus, RefreshCw, Rows3, Search, Trash2, TrendingUp } from "lucide-react";
import { db, schema } from "../../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { formatDate, todayISO } from "@/lib/format";
import { EVENT_TYPES, PRIORITIES } from "@/lib/constants";
import { projectColor } from "@/lib/project-colors";
import { countAttachments } from "@/lib/project-files";
import { addSchedule, applyTemplate, cloneSchedule, deleteSchedule, deleteTask, deleteTemplate, listTemplates, loadSchedules, renameSchedule, saveTemplate, type Schedule, type ScheduleTemplate } from "@/lib/schedules";
import { dayCount, endAfter, wholeDays } from "@/lib/schedule-days";
import { settlePhases } from "@/lib/schedule-phases";
import { logActivity } from "@/lib/activity";
import { notifyProjectEvent } from "@/lib/notify-events";
import { NotifyToggle } from "@/components/project/NotifyToggle";
import { PortfolioCalendar, marksFromPortfolio } from "@/components/PortfolioCalendar";
import { TaskDrawer, type Task } from "@/components/project/TaskDrawer";
import { TaskDetailDialog } from "@/components/project/TaskDetailDialog";
import { BulkEditDialog } from "@/components/project/BulkEditDialog";
import { ScheduleBreakdown } from "@/components/project/ScheduleBreakdown";
import { ScheduleImportDialog } from "@/components/project/ScheduleImportDialog";
import { ScheduleForecast } from "@/components/project/ScheduleForecast";
import type { Dep } from "@/lib/schedule-forecast";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

type CalEvent = typeof schema.calendar_events.$inferSelect;
type View = "tasks" | "wbs" | "forecast" | "calendar" | "gantt";
const DAY = 86400000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const days = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);
const addDays = (iso: string, n: number) => new Date(at(iso) + n * DAY).toISOString().slice(0, 10);

const PRIORITY_DOT: Record<string, string> = { low: "bg-slate-400", medium: "bg-sky-500", high: "bg-amber-500", critical: "bg-red-500" };

/** Schedule: tasks first, then the calendar and the Gantt, all on one page. */
export function ProjectSchedule({ project, people }: SectionProps) {
  const { t, locale } = useI18n();
  const { user, can } = useAuth();
  // A client account reads the schedule: no forecast, nothing to add or change, no task details.
  const viewer = user?.user_type === "external" || user?.view_as === "client";
  const [params, setParams] = useSearchParams();
  const rawView = params.get("view");
  const view: View = rawView === "calendar" || rawView === "gantt" || rawView === "wbs" || (rawView === "forecast" && !viewer) ? rawView : "tasks";
  const color = projectColor(project);

  const [allTasks, setTasks] = useState<Task[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const activeKey = `frx.schedule.${project.id}`;
  const [activeId, setActiveId] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(activeKey)) || null;
    } catch {
      return null;
    }
  });
  /** The name dialog: adding a schedule (id null) or renaming one. */
  const [naming, setNaming] = useState<{ id: number | null; name: string; source: string; start: string; reset: boolean } | null>(null);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  /** The dialog that keeps the open schedule as a template. */
  const [tplName, setTplName] = useState<{ name: string; description: string } | null>(null);
  const openNew = (source = "blank") => {
    const base = schedules.find((x) => x.id === active?.id);
    setNaming({ id: null, name: source.startsWith("clone") && base ? t("sch.cloneName", { name: base.name }) : "", source, start: project.start_date ?? todayISO(), reset: true });
  };
  const active = schedules.find((x) => x.id === activeId) ?? schedules[0] ?? null;
  // Rows made before schedules existed (no schedule) belong to the first one.
  const tasks = useMemo(() => (active ? allTasks.filter((x) => (x.schedule_id ?? schedules[0]?.id) === active.id) : allTasks), [allTasks, active, schedules]);
  const pickSchedule = (id: number) => {
    setActiveId(id);
    try {
      localStorage.setItem(activeKey, String(id));
    } catch {
      /* storage unavailable */
    }
  };
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [deps, setDeps] = useState<Dep[]>([]);
  // Folded groups in the task list, remembered per project.
  const foldKey = `frx.taskGroups.${project.id}`;
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(foldKey) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const setFoldedSaved = (next: Set<string>) => {
    setFolded(next);
    try {
      localStorage.setItem(foldKey, JSON.stringify([...next]));
    } catch {
      /* storage unavailable */
    }
  };
  const [checkCount, setCheckCount] = useState<Record<number, { done: number; total: number }>>({});
  const [noteCount, setNoteCount] = useState<Record<number, number>>({});
  const [fileCount, setFileCount] = useState<Record<number, number>>({});
  /** The task being edited (side editor) and the task shown in the details pop-up. */
  const [openId, setOpenId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "completed">("open");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addPreset, setAddPreset] = useState<{ kind: "task" | "phase" | "break"; parentId: number | null }>({ kind: "task", parentId: null });
  const [eventOpen, setEventOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** Tasks whose dependency links are open in the list. */
  const [relOpen, setRelOpen] = useState<Set<number>>(new Set());
  const [flashId, setFlashId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sched = await loadSchedules(project.id, t("sch.defaultName"));
    setSchedules(sched);
    if (!viewer) setTemplates(await listTemplates().catch(() => []));
    const [taskRows, eventRows, checks, notes, files, depRows] = await Promise.all([
      db.select().from(schema.project_tasks).where(eq(schema.project_tasks.project_id, project.id)).orderBy(asc(schema.project_tasks.end_date), asc(schema.project_tasks.id)),
      db.select().from(schema.calendar_events).where(eq(schema.calendar_events.project_id, project.id)),
      viewer ? Promise.resolve([]) : db.select().from(schema.task_checklist).where(eq(schema.task_checklist.project_id, project.id)),
      viewer ? Promise.resolve([]) : db.select({ task_id: schema.task_notes.task_id }).from(schema.task_notes).where(eq(schema.task_notes.project_id, project.id)),
      viewer ? Promise.resolve({}) : countAttachments(project.id, "task"),
      viewer ? Promise.resolve([]) : db.select({ task_id: schema.task_dependencies.task_id, depends_on_id: schema.task_dependencies.depends_on_id }).from(schema.task_dependencies).where(eq(schema.task_dependencies.project_id, project.id)),
    ]);
    setDeps(depRows);
    // Phases take their dates and status from their tasks; a read-only account sees the same figures without saving them.
    setTasks(await settlePhases(taskRows, !viewer));
    setEvents(eventRows);
    const cc: Record<number, { done: number; total: number }> = {};
    for (const c of checks) {
      const e = (cc[c.task_id] ??= { done: 0, total: 0 });
      e.total++;
      if (c.done === 1) e.done++;
    }
    setCheckCount(cc);
    const nc: Record<number, number> = {};
    for (const n of notes) nc[n.task_id] = (nc[n.task_id] ?? 0) + 1;
    setNoteCount(nc);
    setFileCount(files);
  }, [project.id, viewer]);
  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    if (!naming || !naming.name.trim()) return;
    if (naming.id === null) {
      let row: Schedule;
      if (naming.source.startsWith("clone")) row = await cloneSchedule(project.id, naming.name, tasks, schedules, naming.reset);
      else if (naming.source.startsWith("tpl:")) {
        const tpl = templates.find((x) => x.id === Number(naming.source.slice(4)));
        row = tpl ? await applyTemplate(project.id, naming.name, tpl, naming.start || todayISO(), schedules) : await addSchedule(project.id, naming.name, schedules);
      } else row = await addSchedule(project.id, naming.name, schedules);
      pickSchedule(row.id);
    } else {
      await renameSchedule(naming.id, naming.name);
    }
    setNaming(null);
    await load();
  }

  /** Brings every phase of every schedule of the project up to date with its tasks (dates, status), and says how many changed. */
  async function resync() {
    const rows = await db.select().from(schema.project_tasks).where(eq(schema.project_tasks.project_id, project.id));
    const settled = await settlePhases(rows, true);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const changed = settled.filter((r) => {
      const o = byId.get(r.id);
      return o && (o.start_date !== r.start_date || o.end_date !== r.end_date || o.status !== r.status);
    }).length;
    setNotice(t("sch.resynced", { n: changed }));
    await load();
  }

  async function keepTemplate() {
    if (!tplName || !tplName.name.trim()) return;
    await saveTemplate(tplName.name, tplName.description, tasks, user?.id ?? null);
    setTplName(null);
    setNotice(t("sch.templateSaved"));
    await load();
  }

  async function removeTemplate(id: number) {
    if (!window.confirm(t("sch.templateDeleteConfirm"))) return;
    await deleteTemplate(id);
    setNaming((n) => (n ? { ...n, source: "blank" } : n));
    await load();
  }

  async function removeActive() {
    if (!active || schedules.length < 2) return;
    if (!window.confirm(t("sch.scheduleDeleteConfirm", { name: active.name }))) return;
    await deleteSchedule(project.id, active.id);
    setActiveId(null);
    await load();
  }

  /** The trash at the end of a row: the task goes with its checklist, notes and files, and its phase is worked out again. */
  async function removeTask(task: Task) {
    if (!window.confirm(t("sch.deleteConfirm"))) return;
    await deleteTask(project.id, task.id);
    if (openId === task.id) setOpenId(null);
    if (detailId === task.id) setDetailId(null);
    await load();
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((x) => {
      if (x.kind === "phase") return false;
      if (filter === "open" && x.status === "completed") return false;
      if (filter === "completed" && x.status !== "completed") return false;
      return !q || x.title.toLowerCase().includes(q);
    });
  }, [tasks, filter, query]);
  // The list is grouped by phase (tasks with no phase go together at the end).
  const groups = useMemo(() => {
    const phs = tasks.filter((x) => x.kind === "phase").sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const ordered = (list: Task[]) => [...list].sort((a, b) => a.sort_order - b.sort_order || (a.end_date ?? "").localeCompare(b.end_date ?? "") || a.id - b.id);
    const out: { key: string; title: string; phase: Task | null; items: Task[] }[] = [];
    for (const p of phs) {
      const items = ordered(shown.filter((x) => x.parent_id === p.id));
      const hasAny = tasks.some((x) => x.parent_id === p.id);
      // A phase with nothing under it yet still shows, so tasks can be added to it.
      if (items.length || (!hasAny && !query.trim())) out.push({ key: String(p.id), title: p.title, phase: p, items });
    }
    const loose = ordered(shown.filter((x) => x.parent_id === null || !phs.some((p) => p.id === x.parent_id)));
    if (loose.length) out.push({ key: "none", title: phs.length ? t("sch.noPhaseGroup") : t("sch.allTasks"), phase: null, items: loose });
    return out;
  }, [tasks, shown, t, query]);
  /** Unfinished tasks that this one waits for. */
  const blockersOf = (id: number) =>
    deps
      .filter((d) => d.task_id === id)
      .map((d) => tasks.find((x) => x.id === d.depends_on_id))
      .filter((x): x is Task => Boolean(x) && x!.status !== "completed");
  /** Tasks that cannot start until this one is done. */
  const unlocksOf = (id: number) =>
    deps
      .filter((d) => d.depends_on_id === id)
      .map((d) => tasks.find((x) => x.id === d.task_id))
      .filter((x): x is Task => Boolean(x));
  const phases = tasks.filter((x) => x.kind === "phase").sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const openTask = tasks.find((x) => x.id === openId) ?? null;
  const detailTask = tasks.find((x) => x.id === detailId) ?? null;
  // Editing the whole schedule at once is its own right: administrators, and staff given "Edit the whole schedule".
  const canBulk = !viewer && (Boolean(user?.is_admin) || can("tasks_bulk", "edit", { projectId: project.id }));
  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "";
  const today = todayISO();

  async function toggleDone(task: Task) {
    const closing = task.status !== "completed";
    // A task cannot be closed while something it waits for is still open.
    const waiting = closing ? blockersOf(task.id) : [];
    if (waiting.length) {
      setNotice(t("sch.cannotClose", { names: waiting.map((b) => b.title).join(", ") }));
      return;
    }
    setNotice(null);
    await db.update(schema.project_tasks).set({ status: closing ? "completed" : "in_progress", updated_on: todayISO() }).where(eq(schema.project_tasks.id, task.id));
    await load();
  }

  /** Jump to a task in the list: open its group, make sure it is not filtered out, scroll to it and light it up. */
  function goToTask(id: number) {
    const target = tasks.find((x) => x.id === id);
    if (!target) return;
    setParams({}, { replace: true });
    if (filter === "open" && target.status === "completed") setFilter("all");
    setQuery("");
    const key = target.parent_id !== null && tasks.some((p) => p.id === target.parent_id && p.kind === "phase") ? String(target.parent_id) : "none";
    if (folded.has(key)) {
      const next = new Set(folded);
      next.delete(key);
      setFoldedSaved(next);
    }
    setFlashId(id);
    window.setTimeout(() => document.getElementById(`task-row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2200);
  }

  const tabs: { id: View; label: string; icon: typeof ListChecks }[] = [
    { id: "tasks", label: t("sch.tasks"), icon: ListChecks },
    { id: "wbs", label: t("sch.wbs"), icon: Rows3 },
    { id: "forecast", label: t("sch.forecast"), icon: TrendingUp },
    { id: "calendar", label: t("sch.calendar"), icon: CalendarDays },
    { id: "gantt", label: t("sch.gantt"), icon: GanttChartSquare },
  ].filter((tab) => !(viewer && tab.id === "forecast")) as { id: View; label: string; icon: typeof ListChecks }[];

  return (
    <div className="space-y-4">
      {schedules.length > 1 || !viewer ? (
        <section className="space-y-2" aria-label={t("sch.schedulesLabel")}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("sch.schedulesLabel")}</h2>
            {!viewer && active ? (
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setNaming({ id: active.id, name: active.name, source: "blank", start: "", reset: true })}>
                  <Pencil className="size-4" />
                  {t("sch.scheduleRename")}
                </Button>
                <Button size="sm" variant="ghost" title={t("sch.resyncHint")} onClick={() => void resync()}>
                  <RefreshCw className="size-4" />
                  {t("sch.resync")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openNew("clone")}>
                  <Copy className="size-4" />
                  {t("sch.clone")}
                </Button>
                <Button size="sm" variant="ghost" disabled={tasks.length === 0} onClick={() => setTplName({ name: active.name, description: "" })}>
                  <Bookmark className="size-4" />
                  {t("sch.saveTemplate")}
                </Button>
                {schedules.length > 1 ? (
                  <Button size="icon-sm" variant="ghost" aria-label={t("sch.scheduleDelete")} title={t("sch.scheduleDelete")} onClick={() => void removeActive()}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {schedules.map((sc) => {
              const mine = allTasks.filter((x) => (x.schedule_id ?? schedules[0]?.id) === sc.id);
              const nTasks = mine.filter((x) => x.kind === "task");
              const pct = nTasks.length ? Math.round((nTasks.filter((x) => x.status === "completed").length / nTasks.length) * 100) : 0;
              const on = active?.id === sc.id;
              return (
                <button
                  key={sc.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pickSchedule(sc.id)}
                  className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-all", on ? "shadow-md" : "bg-card hover:bg-muted/50")}
                  style={on ? { background: `color-mix(in srgb, ${color} 14%, var(--card))`, borderColor: color, boxShadow: `inset 0 3px 0 ${color}` } : undefined}
                >
                  <span className="truncate text-base font-semibold">{sc.name}</span>
                  <span className="text-xs text-muted-foreground">{t("sch.scheduleStats", { p: mine.filter((x) => x.kind === "phase").length, n: nTasks.length, pct })}</span>
                  <span className="h-1 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </span>
                </button>
              );
            })}
            {!viewer ? (
              <button type="button" onClick={() => openNew("blank")} className="flex min-h-[76px] items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
                <Plus className="size-4" />
                {t("sch.scheduleNew")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1 max-w-full overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setParams(tab.id === "tasks" ? {} : { view: tab.id }, { replace: true })}
              className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", view === tab.id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              style={view === tab.id ? { background: `color-mix(in srgb, ${color} 18%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
            >
              <tab.icon className="size-4" style={view === tab.id ? { color } : undefined} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className={cn("flex flex-col items-end gap-2", viewer && "hidden")}>
          <div className="flex items-center gap-2">
            {view === "calendar" ? (
              <Button variant="outline" onClick={() => setEventOpen(true)}>
                <Plus className="size-4" />
                {t("sch.addEvent")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp className="size-4" />
              {t("simp.button")}
            </Button>
            <Button
              onClick={() => {
                setAddPreset({ kind: "task", parentId: null });
                setAddOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("sch.addTask")}
            </Button>
          </div>
          {canBulk ? (
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <TableProperties className="size-4" />
              {t("sch.editAll")}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm" role="status">
          <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}
      {view === "tasks" ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5 max-w-full overflow-x-auto">
              {(["open", "completed", "all"] as const).map((f) => (
                <Button key={f} type="button" size="sm" variant={filter === f ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setFilter(f)}>
                  {t(`sch.filter.${f}` as MessageKey)}
                </Button>
              ))}
            </div>
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input className="pl-9" value={query} placeholder={t("sch.search")} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {shown.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">{t("sch.empty")}</Card>
          ) : (
            <>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setFoldedSaved(new Set())}>
                  <ChevronsUpDown className="size-4" />
                  {t("sch.expandAll")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFoldedSaved(new Set(groups.map((g) => g.key)))}>
                  <ChevronsDownUp className="size-4" />
                  {t("sch.collapseAll")}
                </Button>
              </div>
              <div className="space-y-4">
                {groups.map((g) => {
                  const isFolded = folded.has(g.key);
                  const doneCount = g.items.filter((x) => x.status === "completed").length;
                  const pctDone = g.items.length ? Math.round((doneCount / g.items.length) * 100) : 0;
                  return (
                    <section key={g.key}>
                      <button
                        type="button"
                        aria-expanded={!isFolded}
                        onClick={() => {
                          const next = new Set(folded);
                          if (next.has(g.key)) next.delete(g.key);
                          else next.add(g.key);
                          setFoldedSaved(next);
                        }}
                        className="mb-2 flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-colors hover:brightness-95"
                        style={{ background: g.phase ? `color-mix(in srgb, ${color} 14%, var(--card))` : "var(--muted)", borderColor: `color-mix(in srgb, ${color} 28%, var(--border))` }}
                      >
                        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-300", isFolded && "-rotate-90")} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{g.title}</span>
                        {!viewer && g.phase ? (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={t("wbs.addTask")}
                            title={t("wbs.addTask")}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-foreground/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddPreset({ kind: "task", parentId: g.phase!.id });
                              setAddOpen(true);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.stopPropagation();
                                setAddPreset({ kind: "task", parentId: g.phase!.id });
                                setAddOpen(true);
                              }
                            }}
                          >
                            <Plus className="size-3.5" />
                          </span>
                        ) : null}
                        {!viewer && g.phase ? (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={t("sch.modify")}
                            title={t("sch.modify")}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-foreground/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(g.phase!.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.stopPropagation();
                                setOpenId(g.phase!.id);
                              }
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </span>
                        ) : null}
                        <span className="hidden h-1.5 w-24 overflow-hidden rounded-full sm:block" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
                          <span className="block h-full rounded-full" style={{ width: `${pctDone}%`, background: color }} />
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {doneCount}/{g.items.length}
                        </span>
                      </button>
                      <div className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: isFolded ? "0fr" : "1fr" }}>
                        <div className="min-h-0 overflow-hidden">
                          <ul className="space-y-2 pb-1">
                            {g.items.length === 0 ? (
                              <li className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                                {t("sch.emptyPhase")}
                                {!viewer && g.phase ? (
                                  <Button size="sm" variant="outline" onClick={() => { setAddPreset({ kind: "task", parentId: g.phase!.id }); setAddOpen(true); }}>
                                    <Plus className="size-4" />
                                    {t("wbs.addTask")}
                                  </Button>
                                ) : null}
                              </li>
                            ) : null}
                            {g.items.map((task) => {
                              const done = task.status === "completed";
                              const c = checkCount[task.id];
                              const late = !done && task.end_date !== null && task.end_date < today;
                              const blockers = blockersOf(task.id);
                              return (
                                <li key={task.id} id={`task-row-${task.id}`}>
                                  <div
                                    role="button"
                                    tabIndex={isFolded ? -1 : 0}
                                    onClick={() => setDetailId(task.id)}
                                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setDetailId(task.id)}
                                    className={cn("frx-glass group flex cursor-pointer items-center gap-3 border border-[color:var(--glass-edge)] px-4 py-3 transition-all hover:-translate-y-0.5", flashId === task.id && "ring-2 ring-primary")}
                                    style={{ boxShadow: `var(--glass-shadow), inset 3px 0 0 ${done ? "transparent" : blockers.length ? "#ef4444" : color}` }}
                                  >
                                    <button
                                      type="button"
                                      aria-label={t("sch.toggleDone")}
                                      className="shrink-0"
                                      disabled={viewer}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void toggleDone(task);
                                      }}
                                    >
                                      {done ? <CheckCircle2 className="size-5" style={{ color }} /> : <Circle className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <p className={cn("truncate font-medium", done && "text-muted-foreground line-through")}>{task.title}</p>
                                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                        {task.start_date || task.end_date ? (
                                          <span className={cn("tabular-nums", late && "font-semibold text-destructive")}>
                                            {task.start_date ? formatDate(task.start_date, locale) : "…"} → {task.end_date ? formatDate(task.end_date, locale) : "…"}
                                          </span>
                                        ) : null}
                                        {blockers.length ? (
                                          <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                                            <Lock className="size-3.5" />
                                            {t("sch.blockedBy", { names: blockers.map((b) => b.title).join(", ") })}
                                          </span>
                                        ) : null}
                                        {c ? (
                                          <span className="inline-flex items-center gap-1 tabular-nums">
                                            <ListChecks className="size-3.5" />
                                            {c.done}/{c.total}
                                          </span>
                                        ) : null}
                                        {noteCount[task.id] ? (
                                          <span className="inline-flex items-center gap-1">
                                            <MessageSquare className="size-3.5" />
                                            {noteCount[task.id]}
                                          </span>
                                        ) : null}
                                        {fileCount[task.id] ? (
                                          <span className="inline-flex items-center gap-1">
                                            <Paperclip className="size-3.5" />
                                            {fileCount[task.id]}
                                          </span>
                                        ) : null}
                                      </p>
                                    </div>
                                    <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_DOT[task.priority] ?? "bg-slate-400")} title={t(`sch.priority.${task.priority}` as MessageKey)} />
                                    {blockers.length || unlocksOf(task.id).length ? (
                                      <button
                                        type="button"
                                        aria-expanded={relOpen.has(task.id)}
                                        aria-label={t("sch.relations")}
                                        title={t("sch.relations")}
                                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-foreground/10"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRelOpen((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(task.id)) next.delete(task.id);
                                            else next.add(task.id);
                                            return next;
                                          });
                                        }}
                                      >
                                        <ChevronDown className={cn("size-4 transition-transform", !relOpen.has(task.id) && "-rotate-90")} />
                                        {blockers.length + unlocksOf(task.id).length}
                                      </button>
                                    ) : null}
                                    <StatusBadge value={task.status} />
                                    {task.assigned_to ? <UserAvatar name={who(task.assigned_to)} size="sm" /> : null}
                                    {viewer ? null : (
                                      <button
                                        type="button"
                                        aria-label={t("sch.modify")}
                                        title={t("sch.modify")}
                                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenId(task.id);
                                        }}
                                      >
                                        <Pencil className="size-4" />
                                      </button>
                                    )}
                                    {viewer ? null : (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t("sch.delete")}
                                        title={t("sch.delete")}
                                        className="shrink-0 text-muted-foreground hover:text-destructive"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void removeTask(task);
                                        }}
                                        onKeyDown={(e) => e.stopPropagation()}
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    )}
                                  </div>
                                  {relOpen.has(task.id) ? (
                                    <div className="mt-1 ml-6 space-y-1 border-l-2 pl-4" style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}>
                                      {[
                                        { label: t("sch.waitsFor"), list: deps.filter((d) => d.task_id === task.id).map((d) => tasks.find((x) => x.id === d.depends_on_id)).filter((x): x is Task => Boolean(x)) },
                                        { label: t("sch.unlocks"), list: unlocksOf(task.id) },
                                      ]
                                        .filter((g) => g.list.length)
                                        .map((g) => (
                                          <div key={g.label}>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{g.label}</p>
                                            {g.list.map((other) => (
                                              <button
                                                key={other.id}
                                                type="button"
                                                onClick={() => goToTask(other.id)}
                                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/5"
                                              >
                                                <span className={cn("size-2 shrink-0 rounded-full", other.status === "completed" ? "bg-emerald-500" : "bg-red-500")} />
                                                <span className="min-w-0 flex-1 truncate">{other.title}</span>
                                                <span className="text-xs text-muted-foreground">{t(`status.${other.status}` as MessageKey)}</span>
                                                <ChevronRight className="size-3.5 text-muted-foreground" />
                                              </button>
                                            ))}
                                          </div>
                                        ))}
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : null}

      {view === "wbs" ? (
        <ScheduleBreakdown
          project={project}
          scheduleName={active?.name ?? ""}
          tasks={tasks}
          check={checkCount}
          people={people}
          onOpen={setDetailId}
          onEdit={viewer ? undefined : setOpenId}
          readOnly={viewer}
          onAdd={(kind, parentId) => {
            setAddPreset({ kind, parentId });
            setAddOpen(true);
          }}
          onChanged={() => void load()}
        />
      ) : null}

      {view === "forecast" ? <ScheduleForecast project={project} tasks={tasks} deps={deps} check={checkCount} onOpen={setDetailId} /> : null}

      {view === "calendar" ? (
        <Card className="p-5">
          <PortfolioCalendar
            title={t("sch.calendar")}
            projects={[project]}
            marks={marksFromPortfolio([project], events, tasks.map((x) => ({ id: x.id, end_date: x.end_date, title: x.title, project_id: x.project_id })), [], [])}
          />
        </Card>
      ) : null}

      {view === "gantt" ? <TaskGantt tasks={tasks} color={color} checkCount={checkCount} onOpen={setDetailId} /> : null}

      <TaskDetailDialog
        project={project}
        task={detailTask}
        tasks={tasks}
        deps={deps}
        people={people}
        viewer={viewer}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          setOpenId(id);
        }}
        onNavigate={setDetailId}
      />
      {canBulk ? <BulkEditDialog open={bulkOpen} project={project} tasks={tasks} scheduleId={active?.id || null} onClose={() => setBulkOpen(false)} onSaved={() => void load()} /> : null}
      {viewer ? null : <TaskDrawer project={project} task={openTask} people={people} phases={phases} allTasks={tasks} deps={deps} open={openTask !== null} onClose={() => setOpenId(null)} onChanged={() => void load()} />}

      <Dialog open={!!naming} onOpenChange={(o) => !o && setNaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{naming?.id === null ? (naming.source === "clone" ? t("sch.clone") : t("sch.scheduleNew")) : t("sch.scheduleRename")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("sch.scheduleName")}</Label>
            <Input autoFocus value={naming?.name ?? ""} placeholder={t("sch.scheduleNamePh")} onChange={(e) => naming && setNaming({ ...naming, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void saveName()} />
          </div>
          {naming?.id === null ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("sch.startFrom")}</Label>
                <select value={naming.source} onChange={(e) => setNaming({ ...naming, source: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="blank">{t("sch.fromBlank")}</option>
                  {active ? <option value="clone">{t("sch.fromClone", { name: active.name })}</option> : null}
                  {templates.length ? (
                    <optgroup label={t("sch.templates")}>
                      {templates.map((tp) => (
                        <option key={tp.id} value={`tpl:${tp.id}`}>
                          {tp.name} ({tp.item_count})
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
              {naming.source === "clone" ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={naming.reset} onChange={(e) => setNaming({ ...naming, reset: e.target.checked })} />
                  {t("sch.cloneReset")}
                </label>
              ) : null}
              {naming.source.startsWith("tpl:") ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>{t("sch.templateStart")}</Label>
                    <Input type="date" value={naming.start} onChange={(e) => setNaming({ ...naming, start: e.target.value })} />
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void removeTemplate(Number(naming.source.slice(4)))}>
                    <Trash2 className="size-4" />
                    {t("sch.templateDelete")}
                  </Button>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{naming.source === "blank" ? t("sch.scheduleNewHint") : naming.source === "clone" ? t("sch.cloneHint") : t("sch.templateHint")}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(null)}>{t("clients.cancel")}</Button>
            <Button disabled={!naming?.name.trim()} onClick={() => void saveName()}>{t("settings.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!tplName} onOpenChange={(o) => !o && setTplName(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sch.saveTemplate")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("sch.templateName")}</Label>
              <Input autoFocus value={tplName?.name ?? ""} onChange={(e) => tplName && setTplName({ ...tplName, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.description")}</Label>
              <Textarea rows={2} value={tplName?.description ?? ""} onChange={(e) => tplName && setTplName({ ...tplName, description: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">{t("sch.templateSaveHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplName(null)}>{t("clients.cancel")}</Button>
            <Button disabled={!tplName?.name.trim()} onClick={() => void keepTemplate()}>{t("settings.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {viewer ? null : <ScheduleImportDialog open={importOpen} project={project} existing={tasks.length} scheduleId={active?.id || null} userId={user?.id} onClose={() => setImportOpen(false)} onDone={() => void load()} />}
      <AddTaskDialog
        open={addOpen}
        people={people}
        phases={phases}
        preset={addPreset}
        onClose={() => setAddOpen(false)}
        onSave={async (input) => {
          let v = input;
          if (v.newPhase && v.kind !== "phase") {
            const phaseOrder = tasks.filter((x) => x.kind === "phase").reduce((m, x) => Math.max(m, x.sort_order), -1) + 1;
            const [ph] = await db
              .insert(schema.project_tasks)
              .values({ title: v.newPhase, description: null, start_date: v.start_date, end_date: v.end_date, status: "not_started", priority: "medium", kind: "phase", parent_id: null, sort_order: phaseOrder, updated_on: todayISO(), project_id: project.id, schedule_id: active?.id || null })
              .returning();
            v = { ...v, parent_id: ph.id };
          }
          const sameLevel = tasks.filter((x) => (v.kind === "phase" ? x.kind === "phase" : x.parent_id === v.parent_id && x.kind !== "phase"));
          const sort_order = sameLevel.reduce((m, x) => Math.max(m, x.sort_order), -1) + 1;
          const [row] = await db.insert(schema.project_tasks).values({ ...stripNewPhase(v), sort_order, updated_on: todayISO(), project_id: project.id, schedule_id: active?.id || null }).returning();
          await logActivity({ action: "added task", details: v.title, projectId: project.id, userId: user?.id });
          // With the switch on in the dialog, the project's clients are told about the new task.
          if (v.kind !== "break") {
            void notifyProjectEvent({
              kind: "task",
              projectId: project.id,
              audience: "clients",
              subject: `${t("nt.subject.task")} · ${project.project_number} ${project.name}`,
              text: `${v.title}${v.end_date ? ` (${formatDate(v.end_date, locale)})` : ""}\n\n${window.location.origin}/projects/${project.id}/tasks`,
            });
          }
          setAddOpen(false);
          await load();
          if (v.kind !== "phase") setOpenId(row.id);
        }}
      />
      <AddEventDialog
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        onSave={async (v) => {
          await db.insert(schema.calendar_events).values({ ...v, project_id: project.id });
          setEventOpen(false);
          await load();
        }}
      />
    </div>
  );
}

function TaskGantt({ tasks, color, checkCount, onOpen }: { tasks: Task[]; color: string; checkCount: Record<number, { done: number; total: number }>; onOpen: (id: number) => void }) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const rows = tasks.filter((x) => x.start_date || x.end_date).map((x) => {
    let s = (x.start_date || x.end_date)!;
    let e = (x.end_date || x.start_date)!;
    if (e < s) [s, e] = [e, s];
    return { task: x, s, e };
  });
  if (rows.length === 0) return <Card className="p-10 text-center text-sm text-muted-foreground">{t("project.gantt.empty")}</Card>;
  const min = addDays(rows.reduce((m, r) => (r.s < m ? r.s : m), today), -3);
  const max = addDays(rows.reduce((m, r) => (r.e > m ? r.e : m), today), 7);
  const span = Math.max(days(min, max), 14);
  const pct = (iso: string) => (days(min, iso) / span) * 100;
  // A long schedule is drawn wider and scrolls sideways, so the dates never crowd each other: 7 px a day, and a date label
  // only every few weeks when the weeks are narrow.
  const PX_PER_DAY = 7;
  const NAME_COL = 220;
  const everyWeeks = Math.max(1, Math.ceil(96 / (7 * PX_PER_DAY)));
  const weeks: { label: string; left: number }[] = [];
  for (let d = min, i = 0; d <= max; d = addDays(d, 7), i += 1) if (i % everyWeeks === 0) weeks.push({ label: formatDate(d, locale), left: pct(d) });
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(760, NAME_COL + span * PX_PER_DAY) }}>
          <div className="grid grid-cols-[220px_minmax(0,1fr)] border-b bg-muted/40 text-[11px] text-muted-foreground">
            <span className="sticky left-0 z-10 bg-muted px-4 py-2 font-semibold uppercase tracking-wider">{t("sch.tasks")}</span>
            <div className="relative h-8">
              {weeks.map((w) => (
                <span key={w.left} className="absolute top-2 whitespace-nowrap tabular-nums" style={{ left: `${w.left}%` }}>
                  {w.label}
                </span>
              ))}
            </div>
          </div>
          {rows.map(({ task, s, e }) => {
            const done = task.status === "completed";
            const c = checkCount[task.id];
            const progress = done ? 100 : c && c.total ? Math.round((c.done / c.total) * 100) : 0;
            const left = pct(s);
            const width = Math.max(pct(addDays(e, 1)) - left, 1.5);
            return (
              <button key={task.id} type="button" onClick={() => onOpen(task.id)} className="grid w-full grid-cols-[220px_minmax(0,1fr)] items-center border-b border-border/50 text-left transition-colors hover:bg-primary/5">
                <span className={cn("sticky left-0 z-10 truncate bg-card px-4 py-3 text-sm", task.kind === "task" ? "font-medium" : "font-bold")} title={task.title}>
                  {task.title}
                </span>
                <span className="relative block h-12">
                  <span className="absolute inset-y-0 w-px bg-primary/60" style={{ left: `${pct(today)}%` }} />
                  <span
                    className="absolute top-2 flex h-6 items-center overflow-hidden rounded-full"
                    style={{ left: `${left}%`, width: `${width}%`, background: `color-mix(in srgb, ${color} 22%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)` }}
                  >
                    <span className="h-full rounded-full" style={{ width: `${progress}%`, background: `linear-gradient(180deg, color-mix(in srgb, ${color} 75%, white), ${color})` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold [text-shadow:0_0_4px_var(--card)]">{progress}%</span>
                  </span>
                  <span className="absolute top-8 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground" style={{ left: `${left}%` }}>
                    {formatDate(s, locale)} → {formatDate(e, locale)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** The end date for a start date and a duration typed in days; the end stays as it is while the duration is not a whole number. */
function endForDays(start: string, rawDays: string, end: string) {
  const n = wholeDays(rawDays);
  return n !== null && start ? endAfter(start, n) : end;
}

function stripNewPhase<T extends { newPhase?: string }>(v: T): Omit<T, "newPhase"> {
  const { newPhase: _drop, ...rest } = v;
  void _drop;
  return rest;
}

function AddTaskDialog({
  open,
  people,
  phases,
  preset,
  onClose,
  onSave,
}: {
  open: boolean;
  people: SectionProps["people"];
  phases: Task[];
  preset: { kind: "task" | "phase" | "break"; parentId: number | null };
  onClose: () => void;
  onSave: (v: {
    title: string;
    description: string | null;
    start_date: string | null;
    end_date: string | null;
    status: string;
    priority: string;
    assigned_to: number | null;
    kind: string;
    parent_id: number | null;
    /** When set, a new phase of this name is made first and the task goes under it. */
    newPhase?: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const blank = { title: "", description: "", start_date: todayISO(), end_date: "", days: "", priority: "medium", assigned_to: "none", kind: "task", parent: "none", newPhase: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ ...blank, start_date: todayISO(), kind: preset.kind, parent: preset.parentId ? String(preset.parentId) : "none" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sch.addTask")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("wbs.kind")}</Label>
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">{t("wbs.kind.task")}</SelectItem>
                  <SelectItem value="phase">{t("wbs.kind.phase")}</SelectItem>
                  <SelectItem value="break">{t("wbs.kind.break")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {f.kind !== "phase" ? (
              <div className="space-y-1.5">
                <Label>{t("wbs.phase")}</Label>
                <Select value={f.parent} onValueChange={(v) => setF({ ...f, parent: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("wbs.noPhase")}</SelectItem>
                    {phases.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                    ))}
                    <SelectItem value="__new">{t("sch.newPhaseOption")}</SelectItem>
                  </SelectContent>
                </Select>
                {f.parent === "__new" ? <Input correct autoFocus value={f.newPhase} placeholder={t("sch.newPhaseName")} onChange={(e) => setF({ ...f, newPhase: e.target.value })} /> : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tk-title">{t("sch.taskTitle")}</Label>
            <Input correct id="tk-title" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("sch.start")}</Label>
              <Input type="date" value={f.start_date} onChange={(e) => setF((cur) => ({ ...cur, start_date: e.target.value, end_date: endForDays(e.target.value, cur.days, cur.end_date) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.end")}</Label>
              <Input type="date" value={f.end_date} onChange={(e) => setF((cur) => ({ ...cur, end_date: e.target.value, days: dayCount(cur.start_date, e.target.value)?.toString() ?? "" }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.durationDays")}</Label>
              <Input type="number" min={1} step={1} inputMode="numeric" value={f.days} onChange={(e) => setF((cur) => ({ ...cur, days: e.target.value, end_date: endForDays(cur.start_date, e.target.value, cur.end_date) }))} />
              <p className="text-[11px] text-muted-foreground">{t("sch.durationHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.priority")}</Label>
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{t(`sch.priority.${p.value}` as MessageKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.assignee")}</Label>
              <Select value={f.assigned_to} onValueChange={(v) => setF({ ...f, assigned_to: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("sch.unassigned")}</SelectItem>
                  {people.filter((p) => p.user_type === "internal").map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("sch.description")}</Label>
            <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
        </div>
        <NotifyToggle kind="task" who="clients" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("clients.cancel")}</Button>
          <Button
            disabled={busy || !f.title.trim() || (f.kind !== "phase" && f.parent === "__new" && !f.newPhase.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  title: f.title.trim(),
                  description: f.description.trim() || null,
                  start_date: f.start_date || null,
                  end_date: f.end_date || null,
                  status: "not_started",
                  priority: f.priority,
                  assigned_to: f.assigned_to === "none" ? null : Number(f.assigned_to),
                  kind: f.kind,
                  parent_id: f.kind === "phase" || f.parent === "none" || f.parent === "__new" ? null : Number(f.parent),
                  newPhase: f.kind !== "phase" && f.parent === "__new" ? f.newPhase.trim() : undefined,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("pdoc.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEventDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (v: { title: string; event_date: string; end_date: string | null; event_type: string; description: string | null }) => Promise<void> }) {
  const { t } = useI18n();
  const [f, setF] = useState({ title: "", event_date: todayISO(), event_type: "meeting" });
  useEffect(() => {
    if (open) setF({ title: "", event_date: todayISO(), event_type: "meeting" });
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("sch.addEvent")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>{t("sch.taskTitle")}</Label>
            <Input correct autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("exp.date")}</Label>
              <Input type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("exp.category")}</Label>
              <Select value={f.event_type} onValueChange={(v) => setF({ ...f, event_type: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{t(`status.${e.value}` as MessageKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("clients.cancel")}</Button>
          <Button disabled={!f.title.trim()} onClick={() => void onSave({ title: f.title.trim(), event_date: f.event_date, end_date: null, event_type: f.event_type, description: null })}>
            {t("pdoc.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
