import type { Action, ModuleId, Permission, SessionUser } from "./types";

const ACTION_COL: Record<Action, keyof Permission> = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
};

export function can(
  user: SessionUser | null,
  permissions: Permission[],
  module: ModuleId,
  action: Action,
  scope?: { projectId?: number; clientId?: number },
): boolean {
  if (!user || !user.is_active) return false;
  if (user.is_admin) return true;

  const relevant = permissions.filter((p) => p.user_id === user.id && p.module === module);
  if (relevant.length === 0) return false;

  const col = ACTION_COL[action];
  const projectId = scope?.projectId;

  const granted = relevant.some((p) => Number(p[col]) === 1);
  if (!granted) return false;

  if (projectId != null) {
    const projectGrant = relevant.some(
      (p) =>
        Number(p[col]) === 1 &&
        ((p.scope_type === "global" && p.scope_id === 0) ||
          (p.scope_type === "project" && p.scope_id === projectId)),
    );
    return projectGrant;
  }

  return granted;
}

export function visibleProjectModules(
  user: SessionUser | null,
  permissions: Permission[],
  projectId: number,
) {
  const ids: ModuleId[] = ["dashboard", "documents", "tasks", "notes", "forms", "safety", "qrt", "project_billing"];
  // A client sees the overview, its documentation, the schedule, the notes shared with it, QRT and quotes/invoices (no forms, no SST).
  if (user?.user_type === "external" || user?.view_as === "client") return ids.filter((id) => id !== "forms" && id !== "safety");
  return ids.filter((id) => can(user, permissions, id, "view", { projectId }));
}
