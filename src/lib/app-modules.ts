import { MODULES } from "./constants";
import type { Action, ModuleId, SessionUser } from "./types";

type CanFn = (module: ModuleId, action: Action) => boolean;

const PARENT = new Map(MODULES.filter((m) => m.parent).map((m) => [m.id, m.parent as ModuleId]));

/**
 * Staff reach a sidebar item when they may open its section and the item itself.
 * Administrators have every module. Client accounts use their own layout and are not checked here.
 */
export function canUseMenuModule(user: SessionUser | null, can: CanFn, id: ModuleId, action: Action = "view"): boolean {
  if (!user || !user.is_active) return false;
  if (user.user_type === "external" || user.view_as === "client") return true;
  if (user.is_admin) return true;
  const parent = PARENT.get(id);
  return (!parent || can(parent, "view")) && can(id, action);
}
