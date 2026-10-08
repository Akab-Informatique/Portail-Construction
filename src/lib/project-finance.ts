import { eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { deleteBillingFile } from "./billing-files";
import type { BillingFile } from "./types";

/**
 * FRX-private numbers of a project. Clients can never read these tables (the database refuses them).
 * Amounts are before taxes.
 */
export type CostEntry = {
  id: number;
  project_id: number;
  source: "invoice" | "quick";
  supplier: string | null;
  description: string | null;
  incurred_on: string | null;
  amount: number;
  paid: number;
  file_id: number | null;
};

export type StaffFinance = {
  /** Every real cost entered: supplier invoices and quick amounts. */
  costs: CostEntry[];
  /** Quick single amount per project: what the whole project is expected to cost. */
  planned: Map<number, number>;
  /** Older cost plan from the project Budget module, used only when no quick amount is set. */
  plannedFromBudget: Map<number, number>;
  /** Target margin in percent, per project, when set. */
  targets: Map<number, number>;
};

export const EMPTY_FINANCE: StaffFinance = { costs: [], planned: new Map(), plannedFromBudget: new Map(), targets: new Map() };

export async function loadStaffFinance(projectIds: number[]): Promise<StaffFinance> {
  if (projectIds.length === 0) return { ...EMPTY_FINANCE, costs: [] };
  await dbReady;
  const [costRows, finance, items] = await Promise.all([
    db.select().from(schema.project_costs).where(inArray(schema.project_costs.project_id, projectIds)),
    db.select().from(schema.project_finance).where(inArray(schema.project_finance.project_id, projectIds)),
    db.select().from(schema.budget_items).where(inArray(schema.budget_items.project_id, projectIds)),
  ]);
  const planned = new Map<number, number>();
  const targets = new Map<number, number>();
  for (const row of finance) {
    if (row.planned_cost !== null) planned.set(row.project_id, row.planned_cost);
    if (row.target_margin_pct !== null) targets.set(row.project_id, row.target_margin_pct);
  }
  const plannedFromBudget = new Map<number, number>();
  for (const item of items) plannedFromBudget.set(item.project_id, (plannedFromBudget.get(item.project_id) ?? 0) + item.estimated);
  return { costs: costRows as CostEntry[], planned, plannedFromBudget, targets };
}

/** Planned cost of a project: the quick amount if set, otherwise the old Budget-module estimate. */
export function plannedCostOf(finance: StaffFinance, projectId: number) {
  return finance.planned.get(projectId) ?? finance.plannedFromBudget.get(projectId) ?? 0;
}

async function upsertFinance(projectId: number, patch: { target_margin_pct?: number | null; planned_cost?: number | null }) {
  await dbReady;
  const existing = await db.select().from(schema.project_finance).where(eq(schema.project_finance.project_id, projectId));
  if (existing[0]) {
    await db.update(schema.project_finance).set(patch).where(eq(schema.project_finance.id, existing[0].id));
  } else {
    await db.insert(schema.project_finance).values({ project_id: projectId, ...patch });
  }
}

export const saveTargetMargin = (projectId: number, pct: number | null) => upsertFinance(projectId, { target_margin_pct: pct });
export const savePlannedCost = (projectId: number, amount: number | null) => upsertFinance(projectId, { planned_cost: amount });

export async function addCostEntry(entry: Omit<CostEntry, "id">) {
  await dbReady;
  const [row] = await db.insert(schema.project_costs).values(entry).returning();
  return row as CostEntry;
}

export async function setCostPaid(entry: CostEntry, paid: boolean) {
  await db.update(schema.project_costs).set({ paid: paid ? 1 : 0 }).where(eq(schema.project_costs.id, entry.id));
}

/** Removes a cost entry and the supplier invoice PDF attached to it, if any. */
export async function removeCostEntry(entry: CostEntry, file?: BillingFile | null) {
  await db.delete(schema.project_costs).where(eq(schema.project_costs.id, entry.id));
  if (file) await deleteBillingFile(file).catch(() => undefined);
}
