import { and, desc, eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { AI_KEY, getSetting } from "./settings";
import type { BillingFile, BillingRequest, ExtractedDocument } from "./types";

/** Fired after any uploaded document or change request is created/updated. */
export const BILLING_FILES_EVENT = "frx:billing-files";

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BILLING_FILES_EVENT));
}

const now = () => new Date().toISOString();
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

// ---------- reading ----------

export async function listBillingFiles(): Promise<BillingFile[]> {
  await dbReady;
  return (await db.select().from(schema.billing_files).orderBy(desc(schema.billing_files.id))) as BillingFile[];
}

export async function listBillingRequests(): Promise<BillingRequest[]> {
  await dbReady;
  return (await db.select().from(schema.billing_requests).orderBy(desc(schema.billing_requests.id))) as BillingRequest[];
}

/** Published documents of one client (the only ones a client may ever see). */
export async function listPublishedForClient(clientId: number): Promise<BillingFile[]> {
  await dbReady;
  return (await db
    .select()
    .from(schema.billing_files)
    .where(and(eq(schema.billing_files.client_id, clientId), eq(schema.billing_files.published, 1)))
    .orderBy(desc(schema.billing_files.id))) as BillingFile[];
}

export async function listRequestsForClient(clientId: number): Promise<BillingRequest[]> {
  await dbReady;
  return (await db
    .select()
    .from(schema.billing_requests)
    .where(eq(schema.billing_requests.client_id, clientId))
    .orderBy(desc(schema.billing_requests.id))) as BillingRequest[];
}

// ---------- versions and add-ons of a quote ----------
// Before the quote is final, newer versions (1487, 1487-1, 1487-2...) REPLACE each other: the client accepts a version,
// the latest accepted one is in force and the older ones become "void". Once staff mark a version as final, no more
// versions can be added; any new PDF is an add-on (1487-A1...) that the client accepts or declines, and an accepted
// add-on is ADDED to the final quote's total.

/** The original quote of a chain. */
export function rootOf(file: BillingFile, all: BillingFile[]) {
  return file.parent_id ? all.find((f) => f.id === file.parent_id) ?? file : file;
}

/** The original quote followed by its newer versions (not add-ons), oldest first. */
export function versionsOf(file: BillingFile, all: BillingFile[]) {
  const root = rootOf(file, all);
  return [root, ...all.filter((f) => f.parent_id === root.id && f.is_addon !== 1).sort((a, b) => a.id - b.id)];
}

/** Add-ons to the final quote, oldest first. */
export function addonsOf(file: BillingFile, all: BillingFile[]) {
  const root = rootOf(file, all);
  return all.filter((f) => f.parent_id === root.id && f.is_addon === 1).sort((a, b) => a.id - b.id);
}

/** Every document of the quote: versions first, then add-ons. */
export function chainOf(file: BillingFile, all: BillingFile[]) {
  return [...versionsOf(file, all), ...addonsOf(file, all)];
}

/** The final approved version, when staff have marked one. */
export function finalVersion(file: BillingFile, all: BillingFile[]) {
  return versionsOf(file, all).find((f) => f.is_final === 1);
}

/** Newer versions the client can already see (drafts do not count). */
function newerVersions(file: BillingFile, all: BillingFile[]) {
  return versionsOf(file, all).filter((f) => f.id > file.id && f.published === 1);
}

/**
 * Status of one document: "void" when a newer version took its place, "final" for the final approved version.
 * Add-ons simply keep their own status (sent / accepted / rejected).
 */
export function revisionStatus(file: BillingFile, all: BillingFile[]) {
  if (file.kind !== "quote") return displayStatus(file);
  if (file.is_addon === 1) return file.status;
  if (file.status === "rejected") return "rejected";
  const newer = newerVersions(file, all);
  if (file.status === "accepted") {
    if (newer.some((f) => f.status === "accepted")) return "void";
    return file.is_final === 1 ? "final" : "accepted";
  }
  if (file.status === "sent") return file.published === 1 && newer.length > 0 ? "void" : "sent";
  return file.status;
}

/** The version in force: the latest accepted one, else the newest one still waiting, else the original. */
export function currentRevision(file: BillingFile, all: BillingFile[]) {
  const chain = versionsOf(file, all);
  const visible = chain.filter((f) => f.published === 1);
  const live = visible.filter((f) => revisionStatus(f, all) !== "void" && f.status !== "rejected");
  return live.find((f) => f.status === "accepted") ?? live[live.length - 1] ?? chain[0];
}

/** Quote total = the version in force plus every add-on the client accepted. */
export function quoteEffectiveTotal(quote: BillingFile, all: BillingFile[]) {
  const addons = addonsOf(quote, all)
    .filter((a) => a.published === 1 && a.status === "accepted")
    .reduce((sum, a) => sum + a.amount, 0);
  return currentRevision(quote, all).amount + addons;
}

/** Newer documents of a quote (everything except the original). */
export function annexesOf(quote: BillingFile, all: BillingFile[]) {
  return chainOf(quote, all).slice(1);
}

/** A version or add-on the client still has to accept or decline. */
export function isPendingDecision(file: BillingFile, all: BillingFile[]) {
  return file.kind === "quote" && file.published === 1 && file.status === "sent" && revisionStatus(file, all) === "sent";
}

/** Staff mark (or unmark) the final approved version. Only one version per quote can be final. */
export async function setFinalVersion(file: BillingFile, all: BillingFile[], final: boolean) {
  await dbReady;
  const others = versionsOf(file, all).filter((f) => f.id !== file.id && f.is_final === 1).map((f) => f.id);
  if (final && others.length) await db.update(schema.billing_files).set({ is_final: 0 }).where(inArray(schema.billing_files.id, others));
  await db.update(schema.billing_files).set({ is_final: final ? 1 : 0 }).where(eq(schema.billing_files.id, file.id));
  notify();
}

/** Overdue is computed from the due date; staff only ever set sent/paid. */
export function displayStatus(file: BillingFile) {
  if (file.kind === "invoice" && file.status !== "paid" && file.due_on && file.due_on < new Date().toISOString().slice(0, 10)) {
    return "overdue";
  }
  return file.status;
}

// ---------- uploading ----------

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("billing.upload.badFile"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export type UploadInput = {
  file: File;
  kind: "invoice" | "quote";
  clientId: number;
  projectId?: number | null;
  parentId?: number | null;
  requestId?: number | null;
  /** The file is an add-on to the final quote (not a new version). */
  addon?: boolean;
  userId: number;
};

export type UploadResult = {
  record: BillingFile;
  extracted: ExtractedDocument | null;
  /** Message key or text explaining why the AI could not read the file (staff can still type the amounts). */
  aiError: string | null;
};

async function postFiles(body: Record<string, unknown>) {
  const res = await fetch("/api/billing-files", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { res, data };
}

function aiNotesFrom(extracted: ExtractedDocument) {
  return JSON.stringify({ confidence: extracted.confidence, notes: extracted.notes, client_name: extracted.client_name });
}

/**
 * Stores the file and asks the AI to read it. The record stays unpublished until staff confirm the figures.
 * On the live server the file and the analysis go through the API; in local development the file is kept in the
 * browser database and only the analysis uses the dev server.
 */
export async function uploadBillingFile(input: UploadInput): Promise<UploadResult> {
  if (!ACCEPTED_TYPES.includes(input.file.type)) throw new Error("billing.upload.badFile");
  if (input.file.size > MAX_UPLOAD_BYTES) throw new Error("billing.upload.tooBig");
  const data = await toBase64(input.file);

  if (import.meta.env.PROD) {
    const { res, data: payload } = await postFiles({
      action: "upload",
      kind: input.kind,
      client_id: input.clientId,
      project_id: input.projectId ?? null,
      parent_id: input.parentId ?? null,
      request_id: input.requestId ?? null,
      addon: Boolean(input.addon),
      file_name: input.file.name,
      data,
    });
    if (!res.ok) throw new Error(String(payload.error ? `${payload.error}${payload.detail ? `|${payload.detail}` : ""}` : `billing.upload.failed:${res.status}`));
    notify();
    return { record: payload.file as BillingFile, extracted: (payload.extracted as ExtractedDocument | null) ?? null, aiError: payload.ai_error ?? null };
  }

  // Local development
  await dbReady;
  const [row] = await db
    .insert(schema.billing_files)
    .values({
      kind: input.kind,
      client_id: input.clientId,
      project_id: input.projectId ?? null,
      parent_id: input.parentId ?? null,
      request_id: input.requestId ?? null,
      is_addon: input.addon ? 1 : 0,
      status: "sent",
      published: 0,
      file_name: input.file.name,
      file_type: input.file.type,
      file_size: input.file.size,
      ai_status: "pending",
      uploaded_by: input.userId,
      staff_seen: 1,
    })
    .returning();
  await db.insert(schema.billing_file_blobs).values({ file_id: row.id, data });

  let extracted: ExtractedDocument | null = null;
  let aiError: string | null = null;
  try {
    const ai = await getSetting(AI_KEY).then((raw) => (raw ? JSON.parse(raw) : undefined)).catch(() => undefined);
    const { data: payload } = await postFiles({ action: "analyze_data", kind: input.kind, data, ai });
    extracted = (payload.extracted as ExtractedDocument | undefined) ?? null;
    aiError = payload.error ?? (extracted ? null : "ai.notConfigured");
  } catch {
    aiError = "ai.notConfigured";
  }
  const patch = extracted
    ? {
        number: extracted.number ?? "",
        title: extracted.title ?? "",
        issued_on: extracted.issued_on ?? null,
        due_on: extracted.due_on ?? null,
        subtotal: extracted.subtotal ?? null,
        tax_gst: extracted.tax_gst ?? null,
        tax_qst: extracted.tax_qst ?? null,
        amount: extracted.total ?? 0,
        ai_status: "analyzed",
        ai_notes: aiNotesFrom(extracted),
      }
    : { ai_status: aiError === "ai.notConfigured" ? "manual" : "failed", ai_notes: JSON.stringify({ error: aiError }) };
  const [updated] = await db.update(schema.billing_files).set(patch).where(eq(schema.billing_files.id, row.id)).returning();
  notify();
  return { record: updated as BillingFile, extracted, aiError };
}

export type FileDetails = {
  number: string;
  title: string;
  description: string | null;
  subtotal: number | null;
  tax_gst: number | null;
  tax_qst: number | null;
  amount: number;
  issued_on: string | null;
  due_on: string | null;
  status: string;
  project_id: number | null;
};

/** Staff confirm the figures; publishing makes the document visible to the client. */
export async function saveFileDetails(file: BillingFile, details: FileDetails, publish: boolean) {
  await dbReady;
  await db
    .update(schema.billing_files)
    .set({ ...details, published: publish ? 1 : file.published })
    .where(eq(schema.billing_files.id, file.id));
  if (publish && file.request_id) {
    await db.update(schema.billing_requests).set({ status: "answered" }).where(eq(schema.billing_requests.id, file.request_id));
  }
  notify();
}

export async function setFileStatus(file: BillingFile, status: string) {
  await db.update(schema.billing_files).set({ status }).where(eq(schema.billing_files.id, file.id));
  notify();
}

/** Removes a document (and its annexes, requests and stored file). */
export async function deleteBillingFile(file: BillingFile) {
  if (import.meta.env.PROD) {
    const { res, data } = await postFiles({ action: "delete", id: file.id });
    if (!res.ok) throw new Error(String(data.error || "billing.delete.failed"));
    notify();
    return;
  }
  await dbReady;
  const children = await db.select({ id: schema.billing_files.id }).from(schema.billing_files).where(eq(schema.billing_files.parent_id, file.id));
  const ids = [file.id, ...children.map((c) => c.id)];
  await db.delete(schema.billing_file_blobs).where(inArray(schema.billing_file_blobs.file_id, ids));
  await db.delete(schema.billing_requests).where(inArray(schema.billing_requests.file_id, ids));
  await db.delete(schema.billing_files).where(inArray(schema.billing_files.id, ids));
  notify();
}

// ---------- viewing ----------

/** A URL the viewer can show: the API on the live server, a temporary blob URL in local development. */
export async function fileViewUrl(file: BillingFile): Promise<string> {
  if (import.meta.env.PROD) return `/api/billing-files?id=${file.id}`;
  await dbReady;
  const rows = await db.select().from(schema.billing_file_blobs).where(eq(schema.billing_file_blobs.file_id, file.id));
  if (!rows[0]) throw new Error("billing.view.missing");
  const bytes = Uint8Array.from(atob(rows[0].data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: file.file_type || "application/pdf" }));
}

export function releaseViewUrl(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

// ---------- client decisions and requests ----------

export async function decideFile(
  file: BillingFile,
  decision: "accepted" | "rejected",
  input: { signerName?: string; signature?: string },
) {
  await db
    .update(schema.billing_files)
    .set({
      status: decision,
      accepted_by: decision === "accepted" ? input.signerName ?? null : null,
      accepted_at: now(),
      signature: decision === "accepted" ? input.signature ?? null : null,
      staff_seen: 0,
    })
    .where(eq(schema.billing_files.id, file.id));
  notify();
}

export async function createBillingRequest(input: { file: BillingFile; title: string; description: string; userId: number }) {
  const existing = await db
    .select({ id: schema.billing_requests.id })
    .from(schema.billing_requests)
    .where(eq(schema.billing_requests.file_id, input.file.id));
  const [row] = await db
    .insert(schema.billing_requests)
    .values({
      file_id: input.file.id,
      client_id: input.file.client_id,
      number: `DC-${input.file.number || input.file.id}-${String(existing.length + 1).padStart(2, "0")}`,
      title: input.title.trim(),
      description: input.description.trim() || null,
      status: "open",
      requested_by: input.userId,
      requested_at: now(),
      staff_seen: 0,
    })
    .returning();
  notify();
  return row as BillingRequest;
}

export async function markBillingSeen(input: { requestIds?: number[]; fileIds?: number[] }) {
  if (input.requestIds?.length) {
    await db.update(schema.billing_requests).set({ staff_seen: 1 }).where(inArray(schema.billing_requests.id, input.requestIds));
  }
  if (input.fileIds?.length) {
    await db.update(schema.billing_files).set({ staff_seen: 1 }).where(inArray(schema.billing_files.id, input.fileIds));
  }
  notify();
}
