import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { CLIENT_KEY } from "./constants";
import type {
  AccessGroup,
  AccessGroupAudience,
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

/** Permissions from the seeded Default — staff / Default — clients groups (for admin view-as). */
export async function loadDefaultRolePermissions(
  userId: number,
  audience: "internal" | "external",
): Promise<Permission[]> {
  await ensureDefaultGroups();
  const groups = (await db.select().from(schema.access_groups)) as AccessGroup[];
  const family = audience === "external" ? "default:external" : "default:internal";
  const group = groups.find((g) => groupFamily(g) === family);
  if (!group) return [];
  const perms = (await db
    .select()
    .from(schema.access_group_permissions)
    .where(eq(schema.access_group_permissions.group_id, group.id))) as AccessGroupPermission[];
  return perms.map((p) => ({
    id: -p.id,
    user_id: userId,
    module: p.module,
    scope_type: "global" as const,
    scope_id: 0,
    can_view: p.can_view,
    can_create: p.can_create,
    can_edit: p.can_edit,
    can_delete: p.can_delete,
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

    const assigned = await db
      .select()
      .from(schema.user_clients)
      .where(eq(schema.user_clients.user_id, user.id));
    return assigned.map((row) => row.client_id);
  } catch {
    return user.user_type === "external" ? [] : null;
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

function canonGroupName(name: string) {
  return name
    .toLowerCase()
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupFamily(group: AccessGroup) {
  const name = canonGroupName(group.name);
  if (name === "default" || name === "default staff" || name === "default internal") {
    return `default:${group.audience === "external" ? "external" : "internal"}`;
  }
  if (name === "default clients" || name === "default client" || name === "default external") {
    return "default:external";
  }
  if (name === "accounting" || name === "comptabilite" || name === "comptabilité") {
    return "accounting";
  }
  return `${name}:${group.audience}`;
}

async function mergeGroupInto(keeperId: number, extraId: number) {
  if (keeperId === extraId) return;

  const extraPerms = (await db
    .select()
    .from(schema.access_group_permissions)
    .where(eq(schema.access_group_permissions.group_id, extraId))) as AccessGroupPermission[];
  const keeperPerms = (await db
    .select()
    .from(schema.access_group_permissions)
    .where(eq(schema.access_group_permissions.group_id, keeperId))) as AccessGroupPermission[];

  for (const perm of extraPerms) {
    const existing = keeperPerms.find((row) => row.module === perm.module);
    if (!existing) {
      await db.insert(schema.access_group_permissions).values({
        group_id: keeperId,
        module: perm.module,
        can_view: perm.can_view,
        can_create: perm.can_create,
        can_edit: perm.can_edit,
        can_delete: perm.can_delete,
      });
      continue;
    }
    await db
      .update(schema.access_group_permissions)
      .set({
        can_view: existing.can_view || perm.can_view,
        can_create: existing.can_create || perm.can_create,
        can_edit: existing.can_edit || perm.can_edit,
        can_delete: existing.can_delete || perm.can_delete,
      })
      .where(eq(schema.access_group_permissions.id, existing.id));
  }

  const extraClients = (await db
    .select()
    .from(schema.access_group_clients)
    .where(eq(schema.access_group_clients.group_id, extraId))) as AccessGroupClient[];
  const keeperClients = (await db
    .select()
    .from(schema.access_group_clients)
    .where(eq(schema.access_group_clients.group_id, keeperId))) as AccessGroupClient[];
  const haveClients = new Set(keeperClients.map((row) => row.client_id));
  for (const link of extraClients) {
    if (!haveClients.has(link.client_id)) {
      await db.insert(schema.access_group_clients).values({
        group_id: keeperId,
        client_id: link.client_id,
      });
    }
  }

  const extraMembers = (await db
    .select()
    .from(schema.user_access_groups)
    .where(eq(schema.user_access_groups.group_id, extraId))) as UserAccessGroup[];
  const keeperMembers = (await db
    .select()
    .from(schema.user_access_groups)
    .where(eq(schema.user_access_groups.group_id, keeperId))) as UserAccessGroup[];
  const haveUsers = new Set(keeperMembers.map((row) => row.user_id));
  for (const membership of extraMembers) {
    if (!haveUsers.has(membership.user_id)) {
      await db.insert(schema.user_access_groups).values({
        user_id: membership.user_id,
        group_id: keeperId,
      });
    }
  }

  await db.delete(schema.access_group_permissions).where(eq(schema.access_group_permissions.group_id, extraId));
  await db.delete(schema.access_group_clients).where(eq(schema.access_group_clients.group_id, extraId));
  await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.group_id, extraId));
  await db.delete(schema.access_groups).where(eq(schema.access_groups.id, extraId));
}

async function dedupeAccessGroups() {
  const groups = (await db.select().from(schema.access_groups)) as AccessGroup[];
  const buckets = new Map<string, AccessGroup[]>();
  for (const group of groups) {
    const key = groupFamily(group);
    const bucket = buckets.get(key) ?? [];
    bucket.push(group);
    buckets.set(key, bucket);
  }

  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) {
      const only = bucket[0];
      if (!only) continue;
      if (key === "default:internal" && only.name !== "Default — staff") {
        await db.update(schema.access_groups).set({ name: "Default — staff" }).where(eq(schema.access_groups.id, only.id));
      }
      if (key === "default:external" && only.name !== "Default — clients") {
        await db.update(schema.access_groups).set({ name: "Default — clients" }).where(eq(schema.access_groups.id, only.id));
      }
      continue;
    }

    bucket.sort((a, b) => a.id - b.id);
    const keeper = bucket[0];
    for (const extra of bucket.slice(1)) {
      await mergeGroupInto(keeper.id, extra.id);
    }
    if (key === "default:internal" && keeper.name !== "Default — staff") {
      await db.update(schema.access_groups).set({ name: "Default — staff" }).where(eq(schema.access_groups.id, keeper.id));
    }
    if (key === "default:external" && keeper.name !== "Default — clients") {
      await db.update(schema.access_groups).set({ name: "Default — clients" }).where(eq(schema.access_groups.id, keeper.id));
    }
  }
}

async function findOrCreateGroup(input: {
  family: string;
  name: string;
  description: string;
  audience: AccessGroupAudience;
  all_clients: number;
}) {
  const existing = (await db.select().from(schema.access_groups)) as AccessGroup[];
  const found = existing.find((g) => groupFamily(g) === input.family);
  if (found) return found;
  const [created] = await db
    .insert(schema.access_groups)
    .values({
      name: input.name,
      description: input.description,
      audience: input.audience,
      all_clients: input.all_clients,
    })
    .returning();
  return created as AccessGroup;
}

async function seedPermissionsIfEmpty(
  groupId: number,
  rows: { module: string; can_view: number; can_create: number; can_edit: number; can_delete: number }[],
) {
  const existing = await db
    .select()
    .from(schema.access_group_permissions)
    .where(eq(schema.access_group_permissions.group_id, groupId));
  if (existing.length > 0) return;
  for (const row of rows) {
    await db.insert(schema.access_group_permissions).values({ group_id: groupId, ...row });
  }
}

async function ensureModulePermission(
  groupId: number,
  row: { module: string; can_view: number; can_create: number; can_edit: number; can_delete: number },
) {
  const existing = await db
    .select()
    .from(schema.access_group_permissions)
    .where(eq(schema.access_group_permissions.group_id, groupId));
  if (existing.some((p) => p.module === row.module)) return;
  await db.insert(schema.access_group_permissions).values({ group_id: groupId, ...row });
}

async function ensureDefaultGroupsInner() {
  await dedupeAccessGroups();

  const internalDefault = await findOrCreateGroup({
    family: "default:internal",
    name: "Default — staff",
    description: "Base access for internal staff. Combine with other groups — rights add up.",
    audience: "internal",
    all_clients: 1,
  });
  const externalDefault = await findOrCreateGroup({
    family: "default:external",
    name: "Default — clients",
    description: "Read-only site file for client users.",
    audience: "external",
    all_clients: 0,
  });
  const accounting = await findOrCreateGroup({
    family: "accounting",
    name: "Accounting",
    description: "Budget and cost codes. Stacks on top of Default.",
    audience: "internal",
    all_clients: 1,
  });

  const staffModules = [
    "dashboard",
    "calendar",
    "budget",
    "tasks",
    "documents",
    "rfis",
    "change_orders",
    "daily_logs",
    "punch",
    "safety",
    "team",
    "clients",
  ];
  await seedPermissionsIfEmpty(
    internalDefault.id,
    staffModules.map((module) => ({
      module,
      can_view: 1,
      can_create: module === "clients" ? 0 : 1,
      can_edit: module === "clients" ? 0 : 1,
      can_delete: 0,
    })),
  );
  await seedPermissionsIfEmpty(
    externalDefault.id,
    ["dashboard", "calendar", "documents", "punch", "team", "billing"].map((module) => ({
      module,
      can_view: 1,
      can_create: 0,
      can_edit: 0,
      can_delete: 0,
    })),
  );
  await seedPermissionsIfEmpty(accounting.id, [
    { module: "budget", can_view: 1, can_create: 1, can_edit: 1, can_delete: 1 },
  ]);
  await ensureModulePermission(internalDefault.id, {
    module: "billing",
    can_view: 1,
    can_create: 1,
    can_edit: 1,
    can_delete: 0,
  });
  await ensureModulePermission(internalDefault.id, {
    module: "reports",
    can_view: 1,
    can_create: 1,
    can_edit: 1,
    can_delete: 0,
  });
  await ensureModulePermission(externalDefault.id, {
    module: "billing",
    can_view: 1,
    can_create: 0,
    can_edit: 0,
    can_delete: 0,
  });

  const users = await db.select().from(schema.users);
  for (const u of users) {
    if (u.is_admin) continue;
    const already = await db
      .select()
      .from(schema.user_access_groups)
      .where(eq(schema.user_access_groups.user_id, u.id));
    if (already.length > 0) continue;
    const groupId = u.user_type === "external" ? externalDefault.id : internalDefault.id;
    await db.insert(schema.user_access_groups).values({ user_id: u.id, group_id: groupId });
  }

  await dedupeAccessGroups();
}

let ensurePromise: Promise<void> | null = null;

export async function ensureDefaultGroups() {
  if (!ensurePromise) {
    ensurePromise = ensureDefaultGroupsInner().finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
}

export function isDefaultStaffGroup(group: AccessGroup) {
  return groupFamily(group) === "default:internal";
}

export function isDefaultClientGroup(group: AccessGroup) {
  return groupFamily(group) === "default:external";
}
