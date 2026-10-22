import { todayISO } from "./format";

export type TaskLite = { project_id: number; status: string };

const DAY = 86400000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

/** Share of the schedule that is behind us, 0–100. */
export function scheduleElapsed(start: string | null, end: string | null, today = todayISO()) {
  const s = start || end;
  const e = end || start;
  if (!s || !e) return 0;
  const total = Math.max(at(e) - at(s), DAY);
  return Math.max(0, Math.min(100, Math.round(((at(today) - at(s)) / total) * 100)));
}

/**
 * Achievement of a project, 0–100: completed tasks out of all its tasks. A project with no
 * tasks yet falls back to a completed status (100) or to how far its schedule has run.
 */
export function projectAchievement(
  project: { id: number; status: string; start_date: string | null; end_date: string | null },
  tasks: TaskLite[],
) {
  const mine = tasks.filter((t) => t.project_id === project.id);
  if (mine.length > 0) {
    const done = mine.filter((t) => t.status === "completed").length;
    return { percent: Math.round((done / mine.length) * 100), done, total: mine.length, basis: "tasks" as const };
  }
  if (project.status === "completed") return { percent: 100, done: 0, total: 0, basis: "status" as const };
  return { percent: scheduleElapsed(project.start_date, project.end_date), done: 0, total: 0, basis: "schedule" as const };
}
