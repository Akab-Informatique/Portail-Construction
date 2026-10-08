import { addonsOf, currentRevision, listBillingFiles, revisionStatus } from "./billing-files";
import { GST_RATE, QST_RATE } from "./invoice";
import type { BillingFile, Project } from "./types";

/**
 * Money of one project, worked out from the uploaded quotes and invoices (nothing is typed in by hand):
 *  - contract  = accepted quotes (the version in force) plus accepted add-ons  -> the project budget
 *  - invoiced  = every published invoice, paid or not
 *  - paid      = invoices marked paid                                           -> what the client "spent"
 * The *Net figures are before taxes (used for margins, since costs are entered before taxes).
 */
export type ProjectMoney = {
  contract: number;
  contractNet: number;
  /** Quotes the client has not accepted yet. */
  pending: number;
  quotesAccepted: number;
  invoiced: number;
  invoicedNet: number;
  paid: number;
  paidNet: number;
  unpaid: number;
};

export const EMPTY_MONEY: ProjectMoney = {
  contract: 0,
  contractNet: 0,
  pending: 0,
  quotesAccepted: 0,
  invoiced: 0,
  invoicedNet: 0,
  paid: 0,
  paidNet: 0,
  unpaid: 0,
};

/** Amount before taxes: the printed subtotal when known, otherwise the total with the Quebec taxes taken out. */
function net(file: BillingFile) {
  return file.subtotal ?? file.amount / (1 + GST_RATE + QST_RATE);
}

export function buildProjectMoney(files: BillingFile[]): Map<number, ProjectMoney> {
  const published = files.filter((f) => f.published === 1);
  const map = new Map<number, ProjectMoney>();
  const of = (projectId: number) => {
    let entry = map.get(projectId);
    if (!entry) {
      entry = { ...EMPTY_MONEY };
      map.set(projectId, entry);
    }
    return entry;
  };

  for (const root of published.filter((f) => f.kind === "quote" && !f.parent_id)) {
    if (root.project_id === null) continue;
    const current = currentRevision(root, published);
    const status = revisionStatus(current, published);
    const entry = of(root.project_id);
    if (status === "accepted" || status === "final") {
      const addons = addonsOf(root, published).filter((a) => a.status === "accepted");
      entry.contract += current.amount + addons.reduce((sum, a) => sum + a.amount, 0);
      entry.contractNet += net(current) + addons.reduce((sum, a) => sum + net(a), 0);
      entry.quotesAccepted += 1;
    } else if (status === "sent") {
      entry.pending += current.amount;
    }
  }

  for (const invoice of published.filter((f) => f.kind === "invoice")) {
    if (invoice.project_id === null) continue;
    const entry = of(invoice.project_id);
    entry.invoiced += invoice.amount;
    entry.invoicedNet += net(invoice);
    if (invoice.status === "paid") {
      entry.paid += invoice.amount;
      entry.paidNet += net(invoice);
    } else {
      entry.unpaid += invoice.amount;
    }
  }
  return map;
}

/**
 * Replaces the typed-in budget/spent of projects with the derived ones: budget = accepted quotes,
 * spent = paid invoices. The old "spent" (which the project Budget module fills with the real cost) is kept as `cost`.
 */
export function applyProjectMoney<T extends Project>(projects: T[], files: BillingFile[]): T[] {
  const money = buildProjectMoney(files);
  return projects.map((p) => {
    const m = money.get(p.id) ?? EMPTY_MONEY;
    return { ...p, cost: p.cost ?? p.spent, invoiced: m.invoiced, paid: m.paid, budget: m.contract, spent: m.paid };
  });
}

/** Same, loading the quotes and invoices the signed-in user may see. Never throws: projects are returned as they are on failure. */
export async function withProjectMoney<T extends Project>(projects: T[]): Promise<T[]> {
  try {
    return applyProjectMoney(projects, await listBillingFiles());
  } catch (err) {
    console.error("project money failed", err);
    return projects;
  }
}
