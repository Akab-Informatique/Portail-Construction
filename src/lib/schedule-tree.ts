import type { schema } from "../db";

export type Task = typeof schema.project_tasks.$inferSelect;

export type BreakdownRow = {
  /** Row number as printed (the project title is row 1). */
  n: number;
  task: Task;
  kind: "phase" | "task" | "break";
  depth: 0 | 1;
  start: string | null;
  end: string | null;
  /** Whole weeks counted from the first week of the schedule (week 1 = the week the work starts). */
  weekStart: number | null;
  weekEnd: number | null;
  durationWeeks: number | null;
  progress: number;
};

const DAY = 86400000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const days = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);

const bySort = (a: Task, b: Task) => a.sort_order - b.sort_order || a.id - b.id;

/** Monday of the week a date falls in. */
function mondayOf(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Progress of one task: what was typed in, else the checklist, else the status. */
export function taskProgress(task: Task, check?: { done: number; total: number }) {
  if (task.progress !== null && task.progress !== undefined) return Math.max(0, Math.min(100, task.progress));
  if (task.status === "completed") return 100;
  if (check && check.total > 0) return Math.round((check.done / check.total) * 100);
  return task.status === "in_progress" ? 50 : 0;
}

/**
 * The schedule as the preliminary-schedule sheet shows it: phases as headings, their tasks indented under them, every
 * row numbered. Phases without their own dates take them from their tasks; weeks count from the first week of work.
 */
export function buildBreakdown(tasks: Task[], check: Record<number, { done: number; total: number }>, fallbackStart: string | null): BreakdownRow[] {
  const phases = tasks.filter((t) => t.kind === "phase").sort(bySort);
  const phaseIds = new Set(phases.map((p) => p.id));
  const childrenOf = (id: number) => tasks.filter((t) => t.parent_id === id && t.kind !== "phase").sort(bySort);
  // Tasks that belong to no phase keep their place at the top level.
  const loose = tasks.filter((t) => t.kind !== "phase" && (t.parent_id === null || !phaseIds.has(t.parent_id))).sort(bySort);
  // A pause (holidays...) sits between phases, in the order it was given.
  const topLevel = [...phases, ...loose.filter((t) => t.kind === "break")].sort(bySort);
  const looseTasks = loose.filter((t) => t.kind !== "break");

  // Week 1 is the week of the earliest date anywhere in the schedule, so every dated row gets its weeks.
  const dated = tasks.flatMap((t) => [t.start_date, t.end_date]).filter(Boolean) as string[];
  const first = dated.length ? dated.reduce((m, d) => (d < m ? d : m)) : fallbackStart;
  const base = first ? mondayOf(first) : null;
  const week = (iso: string | null) => {
    if (!iso || !base) return null;
    const w = Math.floor(days(base, iso) / 7) + 1;
    return w >= 1 ? w : null;
  };

  const out: BreakdownRow[] = [];
  let n = 2;
  const push = (task: Task, kind: BreakdownRow["kind"], depth: 0 | 1, start: string | null, end: string | null, progress: number) => {
    // A row with only one date counts as that day: its weeks and duration are still worked out.
    let ws = week(start ?? end);
    let we = week(end ?? start);
    if (ws !== null && we !== null && we < ws) [ws, we] = [we, ws];
    out.push({ n: n++, task, kind, depth, start, end, weekStart: ws, weekEnd: we, durationWeeks: ws !== null && we !== null ? we - ws + 1 : null, progress });
  };

  for (const phase of topLevel) {
    if (phase.kind === "break") {
      push(phase, "break", 0, phase.start_date, phase.end_date, 0);
      continue;
    }
    const kids = childrenOf(phase.id);
    const starts = [phase.start_date, ...kids.map((k) => k.start_date)].filter(Boolean) as string[];
    const ends = [phase.end_date, ...kids.map((k) => k.end_date)].filter(Boolean) as string[];
    const start = phase.start_date || (starts.length ? starts.reduce((m, d) => (d < m ? d : m)) : null);
    const end = phase.end_date || (ends.length ? ends.reduce((m, d) => (d > m ? d : m)) : null);
    const kidProgress = kids.map((k) => taskProgress(k, check[k.id]));
    const own = phase.progress !== null ? taskProgress(phase) : kidProgress.length ? Math.round(kidProgress.reduce((a, b) => a + b, 0) / kidProgress.length) : taskProgress(phase, check[phase.id]);
    push(phase, "phase", 0, start, end, own);
    for (const kid of kids) push(kid, kid.kind === "break" ? "break" : "task", 1, kid.start_date, kid.end_date, taskProgress(kid, check[kid.id]));
  }
  for (const task of looseTasks) push(task, "task", 0, task.start_date, task.end_date, taskProgress(task, check[task.id]));
  return out;
}

/** 2026-10-05 → 26-10-05, the way the sheet prints dates. */
export const shortDate = (iso: string | null) => (iso ? iso.slice(2) : "");

export function periodLabel(row: Pick<BreakdownRow, "weekStart" | "weekEnd">, fr: boolean) {
  if (row.weekStart === null || row.weekEnd === null) return "";
  if (row.weekStart === row.weekEnd) return fr ? `Sem. ${row.weekStart}` : `Wk ${row.weekStart}`;
  return fr ? `Sem. ${row.weekStart} à ${row.weekEnd}` : `Wk ${row.weekStart}–${row.weekEnd}`;
}

export function durationLabel(row: Pick<BreakdownRow, "durationWeeks">, fr: boolean) {
  return row.durationWeeks === null ? "" : fr ? `${row.durationWeeks} sem.` : `${row.durationWeeks} wk`;
}

/**
 * The whole schedule on one line, for the schedule-level figures: its first and last day, and its first and last week
 * (counted as the rows are). Null when nothing in it is dated.
 */
export function scheduleSpan(rows: BreakdownRow[]) {
  const starts = rows.map((r) => r.start).filter((d): d is string => !!d);
  const ends = rows.map((r) => r.end).filter((d): d is string => !!d);
  const firstWeeks = rows.map((r) => r.weekStart).filter((w): w is number => w !== null);
  const lastWeeks = rows.map((r) => r.weekEnd).filter((w): w is number => w !== null);
  if (!firstWeeks.length || !lastWeeks.length) return null;
  const weekStart = Math.min(...firstWeeks);
  const weekEnd = Math.max(...lastWeeks);
  return {
    start: starts.length ? starts.reduce((m, d) => (d < m ? d : m)) : null,
    end: ends.length ? ends.reduce((m, d) => (d > m ? d : m)) : null,
    weekStart,
    weekEnd,
    durationWeeks: weekEnd - weekStart + 1,
  };
}
