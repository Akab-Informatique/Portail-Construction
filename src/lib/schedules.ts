import { and, asc, eq, isNull } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
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
  return rows.length ? rows : [{ id: 0, project_id: projectId, name: defaultName, sort_order: 0, created_at: new Date() }];
}

export async function addSchedule(projectId: number, name: string, after: Schedule[]): Promise<Schedule> {
  await dbReady;
  const sort_order = after.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
  const [row] = await db.insert(schema.project_schedules).values({ project_id: projectId, name: name.trim(), sort_order, created_at: new Date() }).returning();
  return row;
}

export async function renameSchedule(id: number, name: string) {
  await dbReady;
  await db.update(schema.project_schedules).set({ name: name.trim() }).where(eq(schema.project_schedules.id, id));
}

/** Removes a schedule with all its phases and tasks (and what hangs on them). */
export async function deleteSchedule(projectId: number, id: number) {
  await dbReady;
  await clearSchedule(projectId, id);
  await db.delete(schema.project_schedules).where(eq(schema.project_schedules.id, id));
}
