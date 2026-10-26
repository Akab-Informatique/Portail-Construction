import { and, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { formatDate, todayISO } from "./format";
import { computeForecast, type Dep } from "./schedule-forecast";
import type { Locale, Project } from "./types";

export const AUTO_NOTES_EVENT = "frx:autonotes";
/** A task that should be under way and has not changed for this many days is flagged. */
export const STALE_DAYS = 7;

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

/** Marks a task as changed today (fields, checklist, notes or files). */
export async function touchTask(taskId: number) {
  await dbReady;
  await db.update(schema.project_tasks).set({ updated_on: todayISO() }).where(eq(schema.project_tasks.id, taskId));
}

type Say = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Keeps the project's automatic notes up to date, for administrators only: one note for each task that is late,
 * that has not changed for a week while it should be under way, or that is held up by an unfinished task.
 * A note is written once; when the condition goes away the note is removed.
 */
const running = new Map<number, Promise<number>>();

export function syncAutoNotes(project: Project, t: Say, locale: Locale): Promise<number> {
  // Two parts of the page may ask at once; the second waits for the first so a note is never written twice.
  const active = running.get(project.id);
  if (active) return active;
  const job = runSync(project, t, locale).finally(() => running.delete(project.id));
  running.set(project.id, job);
  return job;
}

async function runSync(project: Project, t: Say, locale: Locale): Promise<number> {
  await dbReady;
  const today = todayISO();
  const [tasks, depRows, checks, existing] = await Promise.all([
    db.select().from(schema.project_tasks).where(eq(schema.project_tasks.project_id, project.id)),
    db.select({ task_id: schema.task_dependencies.task_id, depends_on_id: schema.task_dependencies.depends_on_id }).from(schema.task_dependencies).where(eq(schema.task_dependencies.project_id, project.id)),
    db.select().from(schema.task_checklist).where(eq(schema.task_checklist.project_id, project.id)),
    db.select().from(schema.project_notes).where(and(eq(schema.project_notes.project_id, project.id), eq(schema.project_notes.auto, 1))),
  ]);
  const deps: Dep[] = depRows;
  const check: Record<number, { done: number; total: number }> = {};
  for (const c of checks) {
    const e = (check[c.task_id] ??= { done: 0, total: 0 });
    e.total++;
    if (c.done === 1) e.done++;
  }

  const wanted = new Map<string, string>();
  const forecast = computeForecast(tasks, deps, check, project.end_date, today);
  for (const item of forecast.items) {
    const task = item.task;
    if (item.done) continue;
    const id = task.id;
    if (task.end_date && task.end_date < today) {
      wanted.set(`late:${id}`, t("auto.late", { task: task.title, n: days(task.end_date, today), date: formatDate(task.end_date, locale) }));
    } else {
      const since = task.updated_on ?? task.start_date;
      if (task.start_date && task.start_date <= today && since && days(since, today) >= STALE_DAYS) {
        wanted.set(`stale:${id}`, t("auto.stale", { task: task.title, n: days(since, today) }));
      }
    }
    if (item.state === "held") wanted.set(`held:${id}`, t("auto.held", { task: task.title, by: item.waitingFor.map((w) => w.title).join(", "), n: item.slipDays }));
  }

  let changed = 0;
  const have = new Set(existing.map((n) => n.auto_key));
  for (const [key, body] of wanted) {
    if (have.has(key)) continue;
    await db.insert(schema.project_notes).values({ project_id: project.id, user_id: null, body, visibility: "admin", auto: 1, auto_key: key });
    changed++;
  }
  for (const note of existing) {
    if (note.auto_key && !wanted.has(note.auto_key)) {
      await db.delete(schema.project_notes).where(eq(schema.project_notes.id, note.id));
      changed++;
    }
  }
  if (changed) window.dispatchEvent(new Event(AUTO_NOTES_EVENT));
  return changed;
}
