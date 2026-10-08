import { and, desc, eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { parseLines, totalsFromLines } from "./invoice";
import type { BillingDocument, InvoiceLine, QuoteChange } from "./types";

/** Fired after any change request / annex is created or updated, so open screens and the bubble refresh. */
export const QUOTE_CHANGES_EVENT = "frx:quote-changes";

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUOTE_CHANGES_EVENT));
}

const now = () => new Date().toISOString();

export async function listChangesForQuote(quoteId: number): Promise<QuoteChange[]> {
  await dbReady;
  const rows = (await db
    .select()
    .from(schema.quote_changes)
    .where(eq(schema.quote_changes.quote_id, quoteId))) as QuoteChange[];
  return rows.sort((a, b) => a.id - b.id);
}

export async function listRecentChanges(limit = 60): Promise<QuoteChange[]> {
  await dbReady;
  return (await db
    .select()
    .from(schema.quote_changes)
    .orderBy(desc(schema.quote_changes.id))
    .limit(limit)) as QuoteChange[];
}

async function nextNumber(quote: BillingDocument) {
  const existing = await db
    .select({ id: schema.quote_changes.id })
    .from(schema.quote_changes)
    .where(eq(schema.quote_changes.quote_id, quote.id));
  return `DC-${quote.number}-${String(existing.length + 1).padStart(2, "0")}`;
}

/** The client asks for a modification or an add-on. FRX is notified and prices it afterwards. */
export async function createClientRequest(input: {
  quote: BillingDocument;
  title: string;
  description: string;
  userId: number;
}) {
  const [row] = await db
    .insert(schema.quote_changes)
    .values({
      quote_id: input.quote.id,
      client_id: input.quote.client_id,
      number: await nextNumber(input.quote),
      origin: "client",
      status: "requested",
      title: input.title.trim(),
      description: input.description.trim() || null,
      amount: 0,
      requested_by: input.userId,
      requested_at: now(),
      staff_seen: 0,
    })
    .returning();
  notify();
  return row as QuoteChange;
}

function priced(lines: InvoiceLine[]) {
  const clean = lines.filter((l) => l.description.trim() || l.unit_price > 0);
  return { clean, totals: totalsFromLines(clean) };
}

/** FRX adds an annex (priced add-on) to a quote; the client then approves or declines it. */
export async function createStaffAnnex(input: {
  quote: BillingDocument;
  title: string;
  description: string;
  lines: InvoiceLine[];
  userId: number;
}) {
  const { clean, totals } = priced(input.lines);
  const [row] = await db
    .insert(schema.quote_changes)
    .values({
      quote_id: input.quote.id,
      client_id: input.quote.client_id,
      number: await nextNumber(input.quote),
      origin: "staff",
      status: "proposed",
      title: input.title.trim(),
      description: input.description.trim() || null,
      line_items: JSON.stringify(clean),
      subtotal: totals.subtotal,
      tax_gst: totals.tax_gst,
      tax_qst: totals.tax_qst,
      amount: totals.amount,
      proposed_by: input.userId,
      proposed_at: now(),
      staff_seen: 1,
    })
    .returning();
  notify();
  return row as QuoteChange;
}

/** FRX prices a client's request, turning it into an annex waiting for approval. */
export async function priceChange(
  change: QuoteChange,
  input: { title: string; description: string; lines: InvoiceLine[]; userId: number },
) {
  const { clean, totals } = priced(input.lines);
  await db
    .update(schema.quote_changes)
    .set({
      status: "proposed",
      title: input.title.trim() || change.title,
      description: input.description.trim() || change.description,
      line_items: JSON.stringify(clean),
      subtotal: totals.subtotal,
      tax_gst: totals.tax_gst,
      tax_qst: totals.tax_qst,
      amount: totals.amount,
      proposed_by: input.userId,
      proposed_at: now(),
      staff_seen: 1,
    })
    .where(eq(schema.quote_changes.id, change.id));
  notify();
}

export async function cancelChange(change: QuoteChange) {
  await db.update(schema.quote_changes).set({ status: "cancelled", staff_seen: 1 }).where(eq(schema.quote_changes.id, change.id));
  notify();
}

/** The client approves (with a signature) or declines a priced annex. FRX is notified. */
export async function decideChange(
  change: QuoteChange,
  decision: "approved" | "rejected",
  input: { userId: number; signerName?: string; signature?: string },
) {
  await db
    .update(schema.quote_changes)
    .set({
      status: decision,
      decided_by: input.userId,
      decided_at: now(),
      signed_by: decision === "approved" ? input.signerName ?? null : null,
      signature: decision === "approved" ? input.signature ?? null : null,
      staff_seen: 0,
    })
    .where(eq(schema.quote_changes.id, change.id));
  notify();
}

export async function markStaffSeen(ids: number[]) {
  if (ids.length === 0) return;
  await db
    .update(schema.quote_changes)
    .set({ staff_seen: 1 })
    .where(and(inArray(schema.quote_changes.id, ids), eq(schema.quote_changes.staff_seen, 0)));
  notify();
}

export function changeLines(change: QuoteChange): InvoiceLine[] {
  return parseLines(change.line_items);
}

/** Sum of annexes the client has approved (taxes included). */
export function approvedChangesTotal(changes: QuoteChange[]) {
  return changes.filter((c) => c.status === "approved").reduce((sum, c) => sum + c.amount, 0);
}

/** Needs a look from FRX: a new request, or a decision the client just made. */
export function staffNeedsAttention(change: QuoteChange) {
  return change.staff_seen === 0 && (change.status === "requested" || change.status === "approved" || change.status === "rejected");
}
