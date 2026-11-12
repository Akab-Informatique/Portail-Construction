import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";

export type ScheduleTask = typeof schema.project_tasks.$inferSelect;

/** The dates and status a phase takes from the tasks under it. */
export type PhaseFields = { start_date: string | null; end_date: string | null; status: string };

/**
 * One status for a group of tasks: completed when all are, in progress once any has started or finished, blocked when one
 * is stuck and nothing has started, otherwise not started.
 */
export function rollUpStatus(statuses: string[]): string {
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.some((s) => s === "in_progress" || s === "completed")) return "in_progress";
  if (statuses.some((s) => s === "blocked")) return "blocked";
  return "not_started";
}

/**
 * The dates and status a phase shows from the tasks under it: the earliest start and the latest end of those tasks (a task
 * with no start counts by its end, and the other way round). Breaks count for the dates only, not for the status.
 * A phase with nothing to go by keeps its own values.
 */
export function phaseFields(phase: ScheduleTask, all: ScheduleTask[]): PhaseFields {
  const kids = all.filter((x) => x.parent_id === phase.id && x.kind !== "phase");
  const starts = kids.map((k) => k.start_date ?? k.end_date).filter((d): d is string => !!d);
  const ends = kids.map((k) => k.end_date ?? k.start_date).filter((d): d is string => !!d);
  const work = kids.filter((k) => k.kind === "task").map((k) => k.status);
  return {
    start_date: starts.length ? starts.reduce((m, d) => (d < m ? d : m)) : phase.start_date,
    end_date: ends.length ? ends.reduce((m, d) => (d > m ? d : m)) : phase.end_date,
    status: work.length ? rollUpStatus(work) : phase.status,
  };
}

/** Whether a phase has tasks under it whose dates (breaks included) and status (tasks only) are worked out, not typed. */
export function phaseHasDatedKids(phase: ScheduleTask, all: ScheduleTask[]) {
  return all.some((x) => x.parent_id === phase.id && x.kind !== "phase" && (x.start_date || x.end_date));
}
export function phaseHasTaskKids(phase: ScheduleTask, all: ScheduleTask[]) {
  return all.some((x) => x.parent_id === phase.id && x.kind === "task");
}

/**
 * Brings every phase up to date with its tasks and returns the list with the phases as they now stand. With `persist`, the
 * phases whose values changed are written; a read-only account only gets the figures for the screen.
 */
export async function settlePhases(tasks: ScheduleTask[], persist: boolean): Promise<ScheduleTask[]> {
  if (persist) await dbReady;
  const out: ScheduleTask[] = [];
  for (const t of tasks) {
    if (t.kind !== "phase") {
      out.push(t);
      continue;
    }
    const f = phaseFields(t, tasks);
    if (f.start_date === t.start_date && f.end_date === t.end_date && f.status === t.status) {
      out.push(t);
      continue;
    }
    out.push({ ...t, ...f });
    if (persist) await db.update(schema.project_tasks).set(f).where(eq(schema.project_tasks.id, t.id));
  }
  return out;
}
