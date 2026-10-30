import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { removeAttachmentsOf } from "./project-files";
import { todayISO } from "./format";
import { parseSchedule, type ParsedSchedule, type PdfPage } from "./schedule-pdf-parse";

/** Reads the PDF in the browser (pdf.js is loaded only when someone imports a schedule) and works out its phases and tasks. */
export async function readSchedulePdf(file: File): Promise<ParsedSchedule> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push({
      items: content.items.flatMap((item) => ("str" in item && item.str.trim() ? [{ s: item.str, x: Math.round(item.transform[4]), y: Math.round(item.transform[5]) }] : [])),
    });
  }
  await doc.destroy();
  return parseSchedule(pages);
}

/** Deletes every phase and task of the project, with what hangs on them (checklists, notes, links, files). */
async function clearSchedule(projectId: number) {
  const rows = await db.select({ id: schema.project_tasks.id }).from(schema.project_tasks).where(eq(schema.project_tasks.project_id, projectId));
  for (const { id } of rows) {
    await db.delete(schema.task_checklist).where(eq(schema.task_checklist.task_id, id));
    await db.delete(schema.task_notes).where(eq(schema.task_notes.task_id, id));
    await db.delete(schema.task_dependencies).where(eq(schema.task_dependencies.task_id, id));
    await db.delete(schema.task_dependencies).where(eq(schema.task_dependencies.depends_on_id, id));
    await removeAttachmentsOf(projectId, "task", id);
  }
  await db.delete(schema.project_tasks).where(eq(schema.project_tasks.project_id, projectId));
}

/** Creates the phases and tasks, in the order of the PDF. `replace` clears the current schedule first. Returns how many were made. */
export async function importSchedule(projectId: number, schedule: ParsedSchedule, options: { replace: boolean; setProjectDates: boolean }) {
  await dbReady;
  if (options.replace) await clearSchedule(projectId);
  const existing = options.replace ? [] : await db.select({ sort_order: schema.project_tasks.sort_order, kind: schema.project_tasks.kind }).from(schema.project_tasks).where(eq(schema.project_tasks.project_id, projectId));
  const base = existing.filter((x) => x.kind === "phase" || x.kind === "break").reduce((m, x) => Math.max(m, x.sort_order), -1) + 1;
  const today = todayISO();
  let phases = 0;
  let tasks = 0;
  for (const [index, phase] of schedule.phases.entries()) {
    const [row] = await db
      .insert(schema.project_tasks)
      .values({
        project_id: projectId,
        title: phase.title,
        description: phase.notes,
        start_date: phase.start,
        end_date: phase.end,
        status: "not_started",
        priority: "medium",
        kind: phase.kind,
        parent_id: null,
        sort_order: base + index,
        responsible: phase.responsible,
        updated_on: today,
      })
      .returning();
    phases += 1;
    if (phase.tasks.length === 0) continue;
    await db.insert(schema.project_tasks).values(
      phase.tasks.map((task, i) => ({
        project_id: projectId,
        title: task.title,
        description: task.notes,
        start_date: task.start,
        end_date: task.end,
        status: "not_started",
        priority: "medium",
        kind: "task",
        parent_id: row.id,
        sort_order: i,
        responsible: task.responsible,
        updated_on: today,
      })),
    );
    tasks += phase.tasks.length;
  }
  if (options.setProjectDates) {
    const starts = schedule.phases.map((p) => p.start).filter((d): d is string => Boolean(d)).sort();
    const ends = schedule.phases.map((p) => p.end).filter((d): d is string => Boolean(d)).sort();
    if (starts[0] && ends.length) await db.update(schema.projects).set({ start_date: starts[0], end_date: ends[ends.length - 1] }).where(eq(schema.projects.id, projectId));
  }
  return { phases, tasks };
}
