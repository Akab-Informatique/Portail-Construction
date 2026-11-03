import { useAuth } from "./auth";
import type { Action, ModuleId } from "./types";

type CanFn = (module: ModuleId, action: Action) => boolean;

/**
 * A client user's pages and actions, as granular as an employee's. The sidebar has three sections (01 Overview, 02 Your company,
 * 03 Accounting) with their pages, and inside a project the client can be given the overview, documents, schedule, notes, QRT
 * and quotes/invoices. Each is Hidden, View or Interact (comment, ask, accept).
 */
export const CLIENT_MARKER: ModuleId = "client_rights";

export const CLIENT_SECTIONS: { id: ModuleId; labelKey: string; items: ModuleId[] }[] = [
  { id: "app_overview", labelKey: "nav.section.overview", items: ["app_dashboard"] },
  { id: "app_client", labelKey: "nav.yourCompany", items: ["app_client_documents", "app_all_projects"] },
  { id: "app_client_acct", labelKey: "nav.section.accounting", items: ["app_client_billing"] },
];

export const CLIENT_PROJECT_MODULES: ModuleId[] = ["dashboard", "documents", "tasks", "notes", "qrt", "project_billing"];

export const CLIENT_MENU_IDS = new Set<ModuleId>(CLIENT_SECTIONS.flatMap((s) => [s.id, ...s.items]));
const SECTION_OF = new Map<ModuleId, ModuleId>(CLIENT_SECTIONS.flatMap((s) => s.items.map((i) => [i, s.id] as const)));

/**
 * Whether a client user may use a page or module. Until a client's pages were set (their own or a group's, marked by
 * "client_rights"), they keep the standard client access they always had; once set, only what was given counts.
 */
export function clientCan(can: CanFn, id: ModuleId, action: Action = "view"): boolean {
  if (!can(CLIENT_MARKER, "view")) return CLIENT_MENU_IDS.has(id) || CLIENT_PROJECT_MODULES.includes(id);
  const section = SECTION_OF.get(id);
  if (section && !can(section, "view")) return false;
  return can(id, action);
}

/** Whether the signed-in person may act (comment, ask, accept...) in a module: staff always, a client only when given Interact. */
export function useCanAct(module: ModuleId, action: Action = "edit"): boolean {
  const { user, can } = useAuth();
  const asClient = user?.user_type === "external" || user?.view_as === "client";
  if (!asClient) return true;
  const unset = !can(CLIENT_MARKER, "view");
  return unset ? true : clientCan((m, a) => can(m, a), module, action);
}
