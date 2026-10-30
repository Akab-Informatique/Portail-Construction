import { eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { removeAttachmentsOf } from "./project-files";
import { AUTO_NOTES_EVENT } from "./task-activity";

/** Fired after any note is created, edited or deleted, so every open view (the notebook, a project's notes, its menu badge) reloads. */
export const NOTES_EVENT = "frx:notes";

export function notifyNotesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTES_EVENT));
  window.dispatchEvent(new Event(AUTO_NOTES_EVENT));
}

const stamp = () => new Date().toISOString();

/** What a notebook page becomes as a project note: its title, then its text. */
export const projectNoteText = (n: { title: string; body: string }) => [n.title.trim(), n.body.trim()].filter(Boolean).join("\n\n");

/** The reverse: a project note's text back into the notebook page's title and body (the page keeps its own title when the text starts with it). */
export function splitNoteText(text: string, title: string) {
  const t = title.trim();
  if (t && text === t) return { title, body: "" };
  if (t && text.startsWith(`${t}\n\n`)) return { title, body: text.slice(t.length + 2) };
  return { title: "", body: text };
}

/** A project note edited on the project's side: the notebook page it came from follows. */
export async function updateProjectNote(id: number, patch: { body: string; visibility?: string }) {
  await dbReady;
  await db
    .update(schema.project_notes)
    .set({ body: patch.body, ...(patch.visibility ? { visibility: patch.visibility } : {}), updated_at: new Date() })
    .where(eq(schema.project_notes.id, id));
  // Only the author can write their own notebook page; for anyone else this touches nothing, and the author's page catches up
  // the next time they open the notebook.
  const linked = await db.select().from(schema.personal_notes).where(eq(schema.personal_notes.shared_note_id, id));
  for (const page of linked) {
    const { title, body } = splitNoteText(patch.body, page.title);
    await db
      .update(schema.personal_notes)
      .set({ title, body, updated_on: stamp(), ...(patch.visibility ? { shared_visibility: patch.visibility } : {}) })
      .where(eq(schema.personal_notes.id, page.id));
  }
  notifyNotesChanged();
}

/**
 * A project note deleted, wherever it is deleted from: its files, its comments and the link from the notebook page all go.
 * A note written by the portal itself (a late task) is only hidden, not deleted, or it would be written again at once.
 */
export async function deleteProjectNote(note: { id: number; project_id: number; auto: number }) {
  await dbReady;
  await removeAttachmentsOf(note.project_id, "note", note.id);
  await db.delete(schema.note_comments).where(eq(schema.note_comments.note_id, note.id));
  if (note.auto === 1) {
    await db.update(schema.project_notes).set({ dismissed: 1 }).where(eq(schema.project_notes.id, note.id));
  } else {
    await db.delete(schema.project_notes).where(eq(schema.project_notes.id, note.id));
  }
  await db.update(schema.personal_notes).set({ shared_note_id: null, shared_visibility: null }).where(eq(schema.personal_notes.shared_note_id, note.id));
  notifyNotesChanged();
}

/** A notebook page deleted: the copy it sent to a project goes with it. */
export async function deletePersonalNote(page: { id: number; project_id: number | null; shared_note_id: number | null }) {
  await dbReady;
  if (page.shared_note_id) {
    const [shared] = await db.select().from(schema.project_notes).where(eq(schema.project_notes.id, page.shared_note_id));
    if (shared) await deleteProjectNote({ id: shared.id, project_id: shared.project_id, auto: shared.auto });
  }
  await removeAttachmentsOf(0, "pnote", page.id);
  await db.delete(schema.personal_notes).where(eq(schema.personal_notes.id, page.id));
  notifyNotesChanged();
}

/**
 * The notebook catches up with the project: a page whose project note was edited elsewhere takes the new text; one whose
 * project note was deleted is no longer linked. Returns true when something changed.
 */
export async function reconcileNotebook(pages: (typeof schema.personal_notes.$inferSelect)[]) {
  const linked = pages.filter((p) => p.shared_note_id);
  if (linked.length === 0) return false;
  await dbReady;
  const rows = await db.select().from(schema.project_notes).where(inArray(schema.project_notes.id, linked.map((p) => p.shared_note_id as number)));
  let changed = false;
  for (const page of linked) {
    const shared = rows.find((r) => r.id === page.shared_note_id);
    if (!shared || shared.dismissed === 1) {
      await db.update(schema.personal_notes).set({ shared_note_id: null, shared_visibility: null }).where(eq(schema.personal_notes.id, page.id));
      changed = true;
      continue;
    }
    const edited = shared.updated_at ? new Date(shared.updated_at).getTime() : 0;
    if (edited > new Date(page.updated_on).getTime() + 1000) {
      const { title, body } = splitNoteText(shared.body, page.title);
      await db.update(schema.personal_notes).set({ title, body, shared_visibility: shared.visibility, updated_on: stamp() }).where(eq(schema.personal_notes.id, page.id));
      changed = true;
    }
  }
  return changed;
}

/** The notebook page changed: the project note it was sent to follows right away. */
export async function pushToProjectNote(page: { shared_note_id: number | null }, value: { title: string; body: string }, visibility?: string) {
  if (!page.shared_note_id) return;
  await dbReady;
  const text = projectNoteText(value);
  if (!text) return;
  await db
    .update(schema.project_notes)
    .set({ body: text, ...(visibility ? { visibility } : {}), updated_at: new Date() })
    .where(eq(schema.project_notes.id, page.shared_note_id));
  notifyNotesChanged();
}
