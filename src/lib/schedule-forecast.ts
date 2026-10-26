import { taskProgress, type Task } from "./schedule-tree";

export type Dep = { task_id: number; depends_on_id: number };

export type ForecastItem = {
  task: Task;
  planStart: string | null;
  planEnd: string | null;
  forecastStart: string | null;
  forecastEnd: string | null;
  /** Days the forecast end is later than the planned end (0 = on time). */
  slipDays: number;
  progress: number;
  done: boolean;
  /** Unfinished tasks this one has to wait for. */
  waitingFor: Task[];
  /** On time / late because of its own pace / held up by something it depends on. */
  state: "done" | "ontrack" | "late" | "held";
  /** Part of the chain that decides the project's end. */
  critical: boolean;
};

export type Forecast = {
  items: ForecastItem[];
  plannedEnd: string | null;
  forecastEnd: string | null;
  slipDays: number;
  counts: { done: number; ontrack: number; late: number; held: number };
  progress: number;
};

const DAY = 86400000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const days = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);
const plus = (iso: string, n: number) => {
  const d = new Date(at(iso) + n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

/** True when making `task` wait for `dependsOn` would close a loop. */
export function wouldCycle(deps: Dep[], task: number, dependsOn: number) {
  if (task === dependsOn) return true;
  const seen = new Set<number>();
  const stack = [dependsOn];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === task) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of deps) if (d.task_id === id) stack.push(d.depends_on_id);
  }
  return false;
}

/**
 * A forecast of when each task, and the whole job, will really finish.
 * A task starts when its planned date has come AND everything it depends on is finished (the forecast end of the
 * latest predecessor); one that should already have started but has not moves to today. A task under way finishes
 * when the remaining part of its duration, at the planned pace, is done.
 */
export function computeForecast(tasks: Task[], deps: Dep[], check: Record<number, { done: number; total: number }>, projectEnd: string | null, today: string): Forecast {
  const work = tasks.filter((t) => t.kind !== "phase" && t.kind !== "break");
  const byId = new Map(work.map((t) => [t.id, t]));
  const preds = new Map<number, number[]>();
  for (const d of deps) {
    if (!byId.has(d.task_id) || !byId.has(d.depends_on_id)) continue;
    preds.set(d.task_id, [...(preds.get(d.task_id) ?? []), d.depends_on_id]);
  }

  const memo = new Map<number, { start: string | null; end: string | null; drivenBy: number | null }>();
  const visiting = new Set<number>();
  const solve = (id: number): { start: string | null; end: string | null; drivenBy: number | null } => {
    const known = memo.get(id);
    if (known) return known;
    const t = byId.get(id)!;
    if (visiting.has(id)) return { start: t.start_date, end: t.end_date, drivenBy: null };
    visiting.add(id);
    const progress = taskProgress(t, check[t.id]);
    const finished = t.status === "completed" || progress >= 100;
    const planStart = t.start_date ?? t.end_date;
    const planEnd = t.end_date ?? t.start_date;
    const duration = planStart && planEnd ? Math.max(1, days(planStart, planEnd) + 1) : 1;

    let result: { start: string | null; end: string | null; drivenBy: number | null };
    if (finished) {
      result = { start: planStart, end: planEnd, drivenBy: null };
    } else {
      // The latest finish among the tasks this one waits for.
      let predEnd: string | null = null;
      let drivenBy: number | null = null;
      for (const p of preds.get(id) ?? []) {
        const r = solve(p);
        if (r.end && (!predEnd || r.end > predEnd)) {
          predEnd = r.end;
          drivenBy = p;
        }
      }
      const startsAfterPred = predEnd ? plus(predEnd, 1) : null;
      const started = progress > 0 || t.status === "in_progress";
      let start = planStart;
      if (startsAfterPred && (!start || startsAfterPred > start)) start = startsAfterPred;
      else drivenBy = null;
      if (!started && start && start < today) start = today;
      if (started) {
        const remaining = Math.max(1, Math.ceil(duration * (1 - progress / 100)));
        const projected = plus(later(today, start) ?? today, remaining - 1);
        result = { start: planStart && planStart < (start ?? today) ? planStart : start, end: later(planEnd, projected), drivenBy };
        if (planEnd && projected <= planEnd) result.end = planEnd;
      } else {
        result = { start, end: start ? plus(start, duration - 1) : planEnd, drivenBy };
      }
    }
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };

  const items: ForecastItem[] = work.map((task) => {
    const r = solve(task.id);
    const progress = taskProgress(task, check[task.id]);
    const done = task.status === "completed" || progress >= 100;
    const planEnd = task.end_date ?? task.start_date;
    const slipDays = !done && planEnd && r.end ? Math.max(0, days(planEnd, r.end)) : 0;
    const waitingFor = (preds.get(task.id) ?? []).map((id) => byId.get(id)!).filter((p) => !(p.status === "completed" || taskProgress(p, check[p.id]) >= 100));
    let state: ForecastItem["state"] = "ontrack";
    if (done) state = "done";
    else if (slipDays > 0 && r.drivenBy !== null && waitingFor.length > 0) state = "held";
    else if (slipDays > 0) state = "late";
    return { task, planStart: task.start_date ?? task.end_date, planEnd, forecastStart: r.start, forecastEnd: r.end, slipDays, progress, done, waitingFor, state, critical: false };
  });

  // Walk back from the task that ends last, through whatever drives it.
  const last = items.filter((i) => !i.done && i.forecastEnd).sort((a, b) => (b.forecastEnd ?? "").localeCompare(a.forecastEnd ?? ""))[0];
  let cursor: number | null = last?.task.id ?? null;
  const guard = new Set<number>();
  while (cursor !== null && !guard.has(cursor)) {
    guard.add(cursor);
    const item = items.find((i) => i.task.id === cursor);
    if (item) item.critical = true;
    cursor = memo.get(cursor)?.drivenBy ?? null;
  }

  const ends = items.map((i) => i.forecastEnd).filter(Boolean) as string[];
  const forecastEnd = ends.length ? ends.reduce((m, d) => (d > m ? d : m)) : null;
  const plannedEnds = work.map((t) => t.end_date ?? t.start_date).filter(Boolean) as string[];
  // The schedule's own planned end (its last planned task); the project's contractual end is only a fallback.
  const plannedEnd = plannedEnds.length ? plannedEnds.reduce((m, d) => (d > m ? d : m)) : projectEnd;
  const total = items.length;
  const count = (s: ForecastItem["state"]) => items.filter((i) => i.state === s).length;
  return {
    items,
    plannedEnd,
    forecastEnd,
    slipDays: plannedEnd && forecastEnd ? Math.max(0, days(plannedEnd, forecastEnd)) : 0,
    counts: { done: count("done"), ontrack: count("ontrack"), late: count("late"), held: count("held") },
    progress: total ? Math.round(items.reduce((s, i) => s + i.progress, 0) / total) : 0,
  };
}
