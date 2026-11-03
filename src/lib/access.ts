import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { CLIENT_KEY, MODULES } from "./constants";
import type {
  AccessGroup,
  AccessGroupClient,
  AccessGroupPermission,
  Permission,
  SessionUser,
  UserAccessGroup,
} from "./types";

export type AccessBundle = {
  groups: AccessGroup[];
  memberships: UserAccessGroup[];
  groupPermissions: AccessGroupPermission[];
  groupClients: AccessGroupClient[];
};

export async function loadAccessBundle(userId: number): Promise<AccessBundle> {
  const memberships = (await db
    .select()
    .from(schema.user_access_groups)
    .where(eq(schema.user_access_groups.user_id, userId))) as UserAccessGroup[];
  const groupIds = memberships.map((m) => m.group_id);
  if (groupIds.length === 0) {
    return { groups: [], memberships, groupPermissions: [], groupClients: [] };
  }
  const [groups, groupPermissions, groupClients] = (await Promise.all([
    db.select().from(schema.access_groups).where(inArray(schema.access_groups.id, groupIds)),
    db.select().from(schema.access_group_permissions).where(inArray(schema.access_group_permissions.group_id, groupIds)),
    db.select().from(schema.access_group_clients).where(inArray(schema.access_group_clients.group_id, groupIds)),
  ])) as [AccessGroup[], AccessGroupPermission[], AccessGroupClient[]];
  return { groups, memberships, groupPermissions, groupClients };
}

/** What an administrator sees when previewing as an employee or a client: no group is involved, so staff get view on every page and a client the standard client access. */
export async function loadDefaultRolePermissions(userId: number, audience: "internal" | "external"): Promise<Permission[]> {
  if (audience === "external") return [];
  return MODULES.map((m, i) => ({
    id: -(i + 1),
    user_id: userId,
    module: m.id,
    scope_type: "global" as const,
    scope_id: 0,
    can_view: 1,
    can_create: 0,
    can_edit: 0,
    can_delete: 0,
  }));
}

export function mergeGroupPermissions(userId: number, bundle: AccessBundle): Permission[] {
  return bundle.groupPermissions.map((p) => ({
    id: -p.id,
    user_id: userId,
    module: p.module,
    scope_type: "global",
    scope_id: 0,
    can_view: p.can_view,
    can_create: p.can_create,
    can_edit: p.can_edit,
    can_delete: p.can_delete,
  }));
}

function readSelectedClientId(): number | null {
  if (typeof window === "undefined") return null;
  const n = Number(localStorage.getItem(CLIENT_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The projects opened by the access groups a person belongs to. */
async function groupProjectIds(userId: number): Promise<number[]> {
  const memberships = await db.select({ group_id: schema.user_access_groups.group_id }).from(schema.user_access_groups).where(eq(schema.user_access_groups.user_id, userId));
  const groupIds = memberships.map((m) => m.group_id);
  if (groupIds.length === 0) return [];
  const rows = await db.select({ project_id: schema.group_projects.project_id }).from(schema.group_projects).where(inArray(schema.group_projects.group_id, groupIds));
  return rows.map((r) => r.project_id);
}

/** `null` = every client. Otherwise the ids the user may see. */
export async function getAccessibleClientIds(
  user: SessionUser | null,
  preferredClientId?: number | null,
): Promise<number[] | null> {
  if (!user || !user.is_active) return [];
  if (user.is_admin) return null;
  if (user.view_as === "client") {
    const selected = preferredClientId ?? readSelectedClientId();
    return selected ? [selected] : [];
  }

  try {
    if (user.user_type === "external") {
      const links = await db
        .select()
        .from(schema.client_users)
        .where(eq(schema.client_users.user_id, user.id));
      return links.map((link) => link.client_id);
    }

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    const live = rows[0] as SessionUser | undefined;
    if (!live) return [];
    if (live.all_clients !== 0) return null;

    // An employee reaches the companies given to them, plus the companies of the projects they are a member of.
    const [assigned, mine] = await Promise.all([
      db.select().from(schema.user_clients).where(eq(schema.user_clients.user_id, user.id)),
      db.select({ project_id: schema.project_members.project_id }).from(schema.project_members).where(eq(schema.project_members.user_id, user.id)),
    ]);
    const memberIds = [...new Set([...mine.map((m) => m.project_id), ...(await groupProjectIds(user.id))])];
    const memberClients = memberIds.length
      ? await db.select({ client_id: schema.projects.client_id }).from(schema.projects).where(inArray(schema.projects.id, memberIds))
      : [];
    return [...new Set([...assigned.map((row) => row.client_id), ...memberClients.map((row) => row.client_id)])];
  } catch {
    return user.user_type === "external" ? [] : null;
  }
}

/**
 * Projects a person may open: `null` = all of them. An employee gets the projects they are a member of
 * plus every project of a company they were given explicitly. Administrators and "all clients" staff see everything.
 */
export async function getAccessibleProjectIds(user: SessionUser | null): Promise<number[] | null> {
  if (!user || !user.is_active) return [];
  // A real client account: only the projects it was assigned to (an administrator previewing as a client sees the whole company).
  if (user.user_type === "external" && user.view_as !== "client" && !user.is_admin) {
    try {
      const mine = await db.select({ project_id: schema.project_members.project_id }).from(schema.project_members).where(eq(schema.project_members.user_id, user.id));
      // Projects opened by a group count too, but only inside the person's own company.
      const viaGroups = await groupProjectIds(user.id);
      if (viaGroups.length === 0) return mine.map((m) => m.project_id);
      const links = await db.select({ client_id: schema.client_users.client_id }).from(schema.client_users).where(eq(schema.client_users.user_id, user.id));
      const own = links.length ? await db.select({ id: schema.projects.id }).from(schema.projects).where(and(inArray(schema.projects.id, viaGroups), inArray(schema.projects.client_id, links.map((l) => l.client_id)))) : [];
      return [...new Set([...mine.map((m) => m.project_id), ...own.map((p) => p.id)])];
    } catch {
      return null;
    }
  }
  if (user.is_admin || user.user_type === "external" || user.view_as === "client") return null;
  try {
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    const live = rows[0] as SessionUser | undefined;
    if (!live || live.all_clients !== 0) return null;
    const [mine, links] = await Promise.all([
      db.select({ project_id: schema.project_members.project_id }).from(schema.project_members).where(eq(schema.project_members.user_id, user.id)),
      db.select({ client_id: schema.user_clients.client_id }).from(schema.user_clients).where(eq(schema.user_clients.user_id, user.id)),
    ]);
    const ids = new Set([...mine.map((m) => m.project_id), ...(await groupProjectIds(user.id))]);
    const clientIds = links.map((l) => l.client_id);
    if (clientIds.length) {
      const extra = await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.client_id, clientIds));
      extra.forEach((p) => ids.add(p.id));
    }
    return [...ids];
  } catch {
    return null;
  }
}

export async function setUserClients(userId: number, clientIds: number[]) {
  const existing = await db
    .select()
    .from(schema.user_clients)
    .where(eq(schema.user_clients.user_id, userId));
  const have = new Set(existing.map((r) => r.client_id));
  const want = new Set(clientIds);
  for (const row of existing) {
    if (!want.has(row.client_id)) {
      await db.delete(schema.user_clients).where(eq(schema.user_clients.id, row.id));
    }
  }
  for (const id of want) {
    if (!have.has(id)) {
      await db.insert(schema.user_clients).values({ user_id: userId, client_id: id });
    }
  }
}

export function groupFitsUser(group: AccessGroup, userType: "internal" | "external") {
  return group.audience === userType;
}

export async function setUserGroups(userId: number, groupIds: number[]) {
  const existing = await db
    .select()
    .from(schema.user_access_groups)
    .where(eq(schema.user_access_groups.user_id, userId));
  const have = new Set(existing.map((r) => r.group_id));
  const want = new Set(groupIds);
  for (const row of existing) {
    if (!want.has(row.group_id)) {
      await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.id, row.id));
    }
  }
  for (const id of want) {
    if (!have.has(id)) {
      await db.insert(schema.user_access_groups).values({ user_id: userId, group_id: id });
    }
  }
}

export async function setGroupClients(groupId: number, clientIds: number[]) {
  const existing = await db
    .select()
    .from(schema.access_group_clients)
    .where(eq(schema.access_group_clients.group_id, groupId));
  const have = new Set(existing.map((r) => r.client_id));
  const want = new Set(clientIds);
  for (const row of existing) {
    if (!want.has(row.client_id)) {
      await db.delete(schema.access_group_clients).where(eq(schema.access_group_clients.id, row.id));
    }
  }
  for (const id of want) {
    if (!have.has(id)) {
      await db.insert(schema.access_group_clients).values({ group_id: groupId, client_id: id });
    }
  }
}

export async function writeGroupFlags(
  groupId: number,
  module: string,
  flags: { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean },
) {
  const rows = await db
    .select()
    .from(schema.access_group_permissions)
    .where(eq(schema.access_group_permissions.group_id, groupId));
  const existing = rows.find((r) => r.module === module);
  const payload = {
    can_view: flags.can_view ? 1 : 0,
    can_create: flags.can_create ? 1 : 0,
    can_edit: flags.can_edit ? 1 : 0,
    can_delete: flags.can_delete ? 1 : 0,
  };
  if (existing) {
    await db
      .update(schema.access_group_permissions)
      .set(payload)
      .where(eq(schema.access_group_permissions.id, existing.id));
  } else {
    await db.insert(schema.access_group_permissions).values({
      group_id: groupId,
      module,
      ...payload,
    });
  }
}

/**
 * Nothing is created behind your back any more: no "Default" group, no "Accounting" group, and nobody is put in a group
 * automatically. Groups exist only because an administrator made them.
 */
export async function ensureDefaultGroups() {
  /* intentionally empty */
}

export function isDefaultStaffGroup(_group: AccessGroup) {
  return false;
}

export function isDefaultClientGroup(_group: AccessGroup) {
  return false;
}
