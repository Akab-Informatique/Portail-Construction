import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { removeAttachmentsOf } from "./project-files";
import { clearSchedule } from "./schedule-pdf-import";

export type Schedule = typeof schema.project_schedules.$inferSelect;

/**
 * The schedules of a project, first one first. A project always has at least one: when none exists yet, one is made (named
 * `defaultName`) and every task that had no schedule goes into it. A read-only account just gets a stand-in.
 */
export async function loadSchedules(projectId: number, defaultName: string): Promise<Schedule[]> {
  await dbReady;
  const read = () => db.select().from(schema.project_schedules).where(eq(schema.project_schedules.project_id, projectId)).orderBy(asc(schema.project_schedules.sort_order), asc(schema.project_schedules.id));
  let rows = await read();
  try {
    if (rows.length === 0) {
      await db.insert(schema.project_schedules).values({ project_id: projectId, name: defaultName, sort_order: 0, created_at: new Date() });
      rows = await read();
    }
    // Tasks made before schedules existed belong to the first one.
    await db.update(schema.project_tasks).set({ schedule_id: rows[0].id }).where(and(eq(schema.project_tasks.project_id, projectId), isNull(schema.project_tasks.schedule_id)));
  } catch {
    /* a client account cannot write: it reads the stand-in below */
  }
  return rows.length ? rows : [{ id: 0, project_id: projectId, name: defaultName, status: "active", sort_order: 0, created_at: new Date() }];
}

export const SCHEDULE_STATUSES = ["draft", "active", "done"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
const cleanStatus = (v: string | undefined): ScheduleStatus => ((SCHEDULE_STATUSES as readonly string[]).includes(v ?? "") ? (v as ScheduleStatus) : "active");

export async function addSchedule(projectId: number, name: string, after: Schedule[], status?: string): Promise<Schedule> {
  await dbReady;
  const sort_order = after.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
  const [row] = await db.insert(schema.project_schedules).values({ project_id: projectId, name: name.trim(), status: cleanStatus(status), sort_order, created_at: new Date() }).returning();
  return row;
}

export async function renameSchedule(id: number, name: string, status?: string) {
  await dbReady;
  await db.update(schema.project_schedules).set({ name: name.trim(), ...(status ? { status: cleanStatus(status) } : {}) }).where(eq(schema.project_schedules.id, id));
}

/** Removes one task with its checklist, notes, dependency links (both ways) and files. */
export async function deleteTask(projectId: number, taskId: number) {
  await dbReady;
  await db.delete(schema.task_checklist).where(eq(schema.task_checklist.task_id, taskId));
  await db.delete(schema.task_notes).where(eq(schema.task_notes.task_id, taskId));
  await db.delete(schema.task_dependencies).where(eq(schema.task_dependencies.task_id, taskId));
  await db.delete(schema.task_dependencies).where(eq(schema.task_dependencies.depends_on_id, taskId));
  await removeAttachmentsOf(projectId, "task", taskId);
  await db.delete(schema.project_tasks).where(eq(schema.project_tasks.id, taskId));
}

/** Removes a schedule with all its phases and tasks (and what hangs on them). */
export async function deleteSchedule(projectId: number, id: number) {
  await dbReady;
  await clearSchedule(projectId, id);
  await db.delete(schema.project_schedules).where(eq(schema.project_schedules.id, id));
}

// ---------------------------------------------------------------- clone and templates

type Task = typeof schema.project_tasks.$inferSelect;

const DAY = 86_400_000;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** One row of a template: dates are kept as days from the schedule's first day, so a template can start on any date. */
export type TemplateItem = {
  ref: number;
  parent: number | null;
  kind: string;
  title: string;
  description: string | null;
  startOffset: number | null;
  endOffset: number | null;
  priority: string;
  responsible: string | null;
  sort: number;
  checklist: string[];
  after: number[];
};
export type ScheduleTemplate = typeof schema.schedule_templates.$inferSelect;

/** Writes the rows (phases first, so tasks can point at them) into a schedule, with checklists and links. */
async function writeRows(projectId: number, scheduleId: number, rows: TemplateItem[], dates: (item: TemplateItem) => { start: string | null; end: string | null }, status: (item: TemplateItem) => { status: string; progress: number | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const made = new Map<number, number>();
  const ordered = [...rows.filter((r) => r.parent === null), ...rows.filter((r) => r.parent !== null)];
  for (const r of ordered) {
    const d = dates(r);
    const s = status(r);
    const [row] = await db
      .insert(schema.project_tasks)
      .values({
        project_id: projectId,
        schedule_id: scheduleId,
        title: r.title,
        description: r.description,
        start_date: d.start,
        end_date: d.end,
        status: s.status,
        progress: s.progress,
        priority: r.priority,
        kind: r.kind,
        parent_id: r.parent === null ? null : (made.get(r.parent) ?? null),
        sort_order: r.sort,
        responsible: r.responsible,
        updated_on: today,
      })
      .returning({ id: schema.project_tasks.id });
    made.set(r.ref, row.id);
    for (const [i, label] of r.checklist.entries()) {
      await db.insert(schema.task_checklist).values({ project_id: projectId, task_id: row.id, label, done: 0, sort_order: i });
    }
  }
  for (const r of rows) {
    for (const dep of r.after) {
      const a = made.get(r.ref);
      const b = made.get(dep);
      if (a && b) await db.insert(schema.task_dependencies).values({ project_id: projectId, task_id: a, depends_on_id: b });
    }
  }
}

/** The tasks of a schedule as template rows (dates as offsets from the earliest start). */
async function itemsOf(tasks: Task[]): Promise<{ items: TemplateItem[]; base: number | null }> {
  const ids = tasks.map((t) => t.id);
  const [checks, deps] = ids.length
    ? await Promise.all([db.select().from(schema.task_checklist).where(inArray(schema.task_checklist.task_id, ids)).orderBy(asc(schema.task_checklist.sort_order), asc(schema.task_checklist.id)), db.select().from(schema.task_dependencies).where(inArray(schema.task_dependencies.task_id, ids))])
    : [[], []];
  const starts = tasks.flatMap((t) => [t.start_date, t.end_date]).filter((d): d is string => !!d).map(dayNumber);
  const base = starts.length ? Math.min(...starts) : null;
  const off = (d: string | null) => (d && base !== null ? dayNumber(d) - base : null);
  const items = tasks.map<TemplateItem>((t) => ({
    ref: t.id,
    parent: t.parent_id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    startOffset: off(t.start_date),
    endOffset: off(t.end_date),
    priority: t.priority,
    responsible: t.responsible,
    sort: t.sort_order,
    checklist: checks.filter((c) => c.task_id === t.id).map((c) => c.label),
    after: deps.filter((d) => d.task_id === t.id).map((d) => d.depends_on_id),
  }));
  return { items, base };
}

/** A new schedule that is a copy of `source`: the same phases, tasks and breaks, dates, checklists and links. `reset` starts every task over. */
export async function cloneSchedule(projectId: number, name: string, tasks: Task[], schedules: Schedule[], reset: boolean, status?: string): Promise<Schedule> {
  await dbReady;
  const created = await addSchedule(projectId, name, schedules, status);
  const { items, base } = await itemsOf(tasks);
  const byRef = new Map(tasks.map((t) => [t.id, t]));
  await writeRows(
    projectId,
    created.id,
    items,
    (i) => {
      const t = byRef.get(i.ref)!;
      return { start: t.start_date, end: t.end_date };
    },
    (i) => {
      const t = byRef.get(i.ref)!;
      return reset ? { status: "not_started", progress: null } : { status: t.status, progress: t.progress };
    },
  );
  void base;
  return created;
}

export async function listTemplates(): Promise<ScheduleTemplate[]> {
  await dbReady;
  return db.select().from(schema.schedule_templates).orderBy(asc(schema.schedule_templates.name));
}

export async function saveTemplate(name: string, description: string, tasks: Task[], userId: number | null) {
  await dbReady;
  const { items } = await itemsOf(tasks);
  await db.insert(schema.schedule_templates).values({ name: name.trim(), description: description.trim() || null, data: JSON.stringify(items), item_count: items.length, created_by: userId, created_at: new Date() });
}

export async function deleteTemplate(id: number) {
  await dbReady;
  await db.delete(schema.schedule_templates).where(eq(schema.schedule_templates.id, id));
}

/** A new schedule built from a template, its first day being `startDate`. */
export async function applyTemplate(projectId: number, name: string, tpl: ScheduleTemplate, startDate: string, schedules: Schedule[], status?: string): Promise<Schedule> {
  await dbReady;
  const items = JSON.parse(tpl.data) as TemplateItem[];
  const created = await addSchedule(projectId, name, schedules, status);
  const start = dayNumber(startDate);
  const at = (o: number | null) => (o === null ? null : isoOf(start + o));
  await writeRows(projectId, created.id, items, (i) => ({ start: at(i.startOffset), end: at(i.endOffset) }), () => ({ status: "not_started", progress: null }));
  return created;
}
