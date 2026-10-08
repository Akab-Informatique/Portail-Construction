import { eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";

/** FRX-private numbers of a project. Clients can never read these tables (the database refuses them). */
export type ProjectCosts = { estimated: number; actual: number };

export type StaffFinance = {
  /** Costs from the project Budget module: planned (estimated) and real (actual) cost per project. */
  costs: Map<number, ProjectCosts>;
  /** Target margin in percent, per project, when set. */
  targets: Map<number, number>;
};

export async function loadStaffFinance(projectIds: number[]): Promise<StaffFinance> {
  const costs = new Map<number, ProjectCosts>();
  const targets = new Map<number, number>();
  if (projectIds.length === 0) return { costs, targets };
  await dbReady;
  const [items, finance] = await Promise.all([
    db.select().from(schema.budget_items).where(inArray(schema.budget_items.project_id, projectIds)),
    db.select().from(schema.project_finance).where(inArray(schema.project_finance.project_id, projectIds)),
  ]);
  for (const item of items) {
    const entry = costs.get(item.project_id) ?? { estimated: 0, actual: 0 };
    entry.estimated += item.estimated;
    entry.actual += item.actual;
    costs.set(item.project_id, entry);
  }
  for (const row of finance) {
    if (row.target_margin_pct !== null) targets.set(row.project_id, row.target_margin_pct);
  }
  return { costs, targets };
}

export async function saveTargetMargin(projectId: number, pct: number | null) {
  await dbReady;
  const existing = await db.select().from(schema.project_finance).where(eq(schema.project_finance.project_id, projectId));
  if (existing[0]) {
    await db.update(schema.project_finance).set({ target_margin_pct: pct }).where(eq(schema.project_finance.id, existing[0].id));
  } else {
    await db.insert(schema.project_finance).values({ project_id: projectId, target_margin_pct: pct });
  }
}
