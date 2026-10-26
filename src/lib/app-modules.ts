import { MODULES } from "./constants";
import type { Action, ModuleId, SessionUser } from "./types";

type CanFn = (module: ModuleId, action: Action) => boolean;

const CLIENT_MODULES = new Set<ModuleId>(["app_overview", "app_dashboard", "app_client", "app_client_documents", "app_all_projects"]);

const PARENT = new Map(MODULES.filter((m) => m.parent).map((m) => [m.id, m.parent as ModuleId]));

/**
 * Staff reach a sidebar item when they may open its section and the item itself.
 * Administrators have every module. Client accounts use their own layout and are not checked here.
 */
export function canUseMenuModule(user: SessionUser | null, can: CanFn, id: ModuleId, action: Action = "view"): boolean {
  if (!user || !user.is_active) return false;
  // A client account sees only its dashboard, the documentation it was given and its projects.
  if (user.user_type === "external" || user.view_as === "client") return CLIENT_MODULES.has(id);
  if (user.is_admin) return true;
  const parent = PARENT.get(id);
  return (!parent || can(parent, "view")) && can(id, action);
}
