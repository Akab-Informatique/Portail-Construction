import { and, desc, eq, like } from "drizzle-orm";
import { db, dbReady, schema } from "../db";

export type AttachmentOwner = "task" | "note" | "sst" | "qrt" | "form" | "pnote";

export type Attachment = {
  id: number;
  file_name: string;
  file_type: string | null;
  file_size: number;
  uploaded_by: number | null;
  created_at: Date;
};

/** Photos are shrunk before they are stored; everything else is capped. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_EDGE = 1600;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** A phone photo is several MB; 1600 px JPEG is plenty for a job file and a few hundred KB. */
async function shrinkImage(file: File): Promise<{ bytes: Uint8Array; type: string; name: string } | null> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "image/jpeg", name: file.name.replace(/\.\w+$/, "") + ".jpg" };
  } catch {
    return null;
  }
}

const cols = {
  id: schema.project_attachments.id,
  file_name: schema.project_attachments.file_name,
  file_type: schema.project_attachments.file_type,
  file_size: schema.project_attachments.file_size,
  uploaded_by: schema.project_attachments.uploaded_by,
  created_at: schema.project_attachments.created_at,
};

export async function listAttachments(projectId: number, owner: AttachmentOwner, ownerId: number): Promise<Attachment[]> {
  await dbReady;
  return (await db
    .select(cols)
    .from(schema.project_attachments)
    .where(and(eq(schema.project_attachments.project_id, projectId), eq(schema.project_attachments.owner_type, owner), eq(schema.project_attachments.owner_id, ownerId)))
    .orderBy(desc(schema.project_attachments.id))) as Attachment[];
}

/** How many files hang on each owner, for badges in lists. */
export async function countAttachments(projectId: number, owner: AttachmentOwner): Promise<Record<number, number>> {
  await dbReady;
  const rows = await db
    .select({ owner_id: schema.project_attachments.owner_id })
    .from(schema.project_attachments)
    .where(and(eq(schema.project_attachments.project_id, projectId), eq(schema.project_attachments.owner_type, owner)));
  const out: Record<number, number> = {};
  for (const r of rows) out[r.owner_id] = (out[r.owner_id] ?? 0) + 1;
  return out;
}

export async function addAttachment(file: File, input: { projectId: number; owner: AttachmentOwner; ownerId: number; userId: number | null }) {
  const shrunk = await shrinkImage(file);
  const bytes = shrunk?.bytes ?? new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error("tooBig");
  await dbReady;
  await db.insert(schema.project_attachments).values({
    project_id: input.projectId,
    owner_type: input.owner,
    owner_id: input.ownerId,
    file_name: shrunk?.name ?? file.name,
    file_type: shrunk?.type ?? (file.type || null),
    file_size: bytes.length,
    data: toBase64(bytes),
    uploaded_by: input.userId,
  });
}

export async function attachmentBlob(id: number): Promise<Blob | null> {
  await dbReady;
  const [row] = await db
    .select({ data: schema.project_attachments.data, file_type: schema.project_attachments.file_type })
    .from(schema.project_attachments)
    .where(eq(schema.project_attachments.id, id));
  if (!row) return null;
  const binary = atob(row.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: row.file_type || "application/octet-stream" });
}

export async function removeAttachment(id: number) {
  await db.delete(schema.project_attachments).where(eq(schema.project_attachments.id, id));
}

/** Delete everything hanging on an owner (used when a task or note is removed). */
export async function removeAttachmentsOf(projectId: number, owner: AttachmentOwner, ownerId: number) {
  await db
    .delete(schema.project_attachments)
    .where(and(eq(schema.project_attachments.project_id, projectId), eq(schema.project_attachments.owner_type, owner), eq(schema.project_attachments.owner_id, ownerId)));
}

/** The newest photos on a project (tasks, notes, safety), for the overview. */
export async function latestPhotos(projectId: number, limit = 8): Promise<Attachment[]> {
  await dbReady;
  return (await db
    .select(cols)
    .from(schema.project_attachments)
    .where(and(eq(schema.project_attachments.project_id, projectId), like(schema.project_attachments.file_type, "image/%")))
    .orderBy(desc(schema.project_attachments.id))
    .limit(limit)) as Attachment[];
}

/** Copies every file of one owner to another (a personal note sent to a project's notes keeps its photos). */
export async function copyAttachments(
  from: { projectId: number; owner: AttachmentOwner; ownerId: number },
  to: { projectId: number; owner: AttachmentOwner; ownerId: number },
  userId: number | null,
) {
  await dbReady;
  const rows = await db
    .select()
    .from(schema.project_attachments)
    .where(and(eq(schema.project_attachments.project_id, from.projectId), eq(schema.project_attachments.owner_type, from.owner), eq(schema.project_attachments.owner_id, from.ownerId)));
  for (const r of rows) {
    await db.insert(schema.project_attachments).values({
      project_id: to.projectId,
      owner_type: to.owner,
      owner_id: to.ownerId,
      file_name: r.file_name,
      file_type: r.file_type,
      file_size: r.file_size,
      data: r.data,
      uploaded_by: userId,
    });
  }
}

export type PdfAttachment ={ name: string; size: number; dataUrl: string | null };

/** The files on an owner for a PDF: photos come with their picture, other files are listed by name. */
export async function attachmentsForPdf(projectId: number, owner: AttachmentOwner, ownerId: number): Promise<PdfAttachment[]> {
  await dbReady;
  const rows = await db
    .select({ file_name: schema.project_attachments.file_name, file_type: schema.project_attachments.file_type, file_size: schema.project_attachments.file_size, data: schema.project_attachments.data })
    .from(schema.project_attachments)
    .where(and(eq(schema.project_attachments.project_id, projectId), eq(schema.project_attachments.owner_type, owner), eq(schema.project_attachments.owner_id, ownerId)))
    .orderBy(schema.project_attachments.id);
  return rows.map((r) => ({
    name: r.file_name,
    size: r.file_size,
    dataUrl: /^image\/(jpeg|png)$/.test(r.file_type ?? "") ? `data:${r.file_type};base64,${r.data}` : null,
  }));
}
