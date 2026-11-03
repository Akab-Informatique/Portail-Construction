import { and, eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { clearShareFlags, setShareFlags } from "./sharepoint";
import { levelFlags, type DocLevel } from "./doc-rights";
import { clearReportAccessFor } from "./report-access";
import { setUserGroups, writeGroupFlags } from "./access";
import { sendUserLink } from "./users-api";
import type { AccessGroupAudience } from "./types";

/** What an administrator picks, right in the form that creates a person, to give them access from day one. */
export type AccessDraft = {
  groupIds: number[];
  projectIds: number[];
  /** The level on the whole library (a subfolder can be set later); "none" gives nothing. */
  docLevel: DocLevel;
  /** Email the person a link to choose their password. */
  invite: boolean;
};

export const EMPTY_ACCESS: AccessDraft = { groupIds: [], projectIds: [], docLevel: "none", invite: true };

export type Flags = { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };
export const NO_FLAGS: Flags = { can_view: false, can_create: false, can_edit: false, can_delete: false };

/** Gives a new person what the form asked for: groups, projects, a level on the library, and the invitation email. */
export async function applyAccess(input: {
  userId: number;
  /** 0 for an employee; a client company's id for a client user. */
  clientId: number;
  draft: AccessDraft;
  locale: string;
}): Promise<{ invite: "sent" | "local" | "failed" | "off"; inviteError?: string }> {
  const { userId, clientId, draft } = input;
  if (draft.groupIds.length) await setUserGroups(userId, draft.groupIds);
  if (draft.projectIds.length) await setUserProjects(userId, draft.projectIds, undefined, input.clientId === 0 ? "Staff" : "Client");
  if (draft.docLevel !== "none") {
    await setShareFlags({ folderId: 0, clientId, userId, itemId: "", flags: levelFlags(draft.docLevel) });
  }
  if (!draft.invite) return { invite: "off" };
  try {
    const out = await sendUserLink(userId, "invite", input.locale);
    return { invite: out.local ? "local" : "sent" };
  } catch (err) {
    return { invite: "failed", inviteError: err instanceof Error ? err.message : undefined };
  }
}

/**
 * Sets the projects a person is a member of. `scope` limits the change to some projects (a client user: those of their
 * company), so memberships outside it are left alone.
 */
export async function setUserProjects(userId: number, projectIds: number[], scope?: number[], role = "Staff") {
  await dbReady;
  const existing = await db.select().from(schema.project_members).where(eq(schema.project_members.user_id, userId));
  const want = new Set(projectIds);
  const inScope = (id: number) => !scope || scope.includes(id);
  for (const row of existing) {
    if (inScope(row.project_id) && !want.has(row.project_id)) await db.delete(schema.project_members).where(eq(schema.project_members.id, row.id));
  }
  const have = new Set(existing.map((r) => r.project_id));
  for (const id of want) {
    if (inScope(id) && !have.has(id)) await db.insert(schema.project_members).values({ project_id: id, user_id: userId, role });
  }
}

/** The companies an employee was given in full (every project of each). */
export async function setUserCompanies(userId: number, clientIds: number[]) {
  await dbReady;
  const existing = await db.select().from(schema.user_clients).where(eq(schema.user_clients.user_id, userId));
  const want = new Set(clientIds);
  for (const row of existing) if (!want.has(row.client_id)) await db.delete(schema.user_clients).where(eq(schema.user_clients.id, row.id));
  const have = new Set(existing.map((r) => r.client_id));
  for (const id of want) if (!have.has(id)) await db.insert(schema.user_clients).values({ user_id: userId, client_id: id });
}

export async function setAllClients(userId: number, all: boolean) {
  await dbReady;
  await db.update(schema.users).set({ all_clients: all ? 1 : 0 }).where(eq(schema.users.id, userId));
}

/** A person's own right on a module (on top of their groups'). All four off removes the row. */
export async function writeUserFlags(userId: number, module: string, flags: Flags) {
  await dbReady;
  const rows = await db.select().from(schema.user_permissions).where(eq(schema.user_permissions.user_id, userId));
  const existing = rows.find((r) => r.module === module && r.scope_type === "global" && r.scope_id === 0);
  const none = !flags.can_view && !flags.can_create && !flags.can_edit && !flags.can_delete;
  if (existing && none) {
    await db.delete(schema.user_permissions).where(eq(schema.user_permissions.id, existing.id));
    return;
  }
  const payload = { can_view: flags.can_view ? 1 : 0, can_create: flags.can_create ? 1 : 0, can_edit: flags.can_edit ? 1 : 0, can_delete: flags.can_delete ? 1 : 0 };
  if (existing) await db.update(schema.user_permissions).set(payload).where(eq(schema.user_permissions.id, existing.id));
  else if (!none) await db.insert(schema.user_permissions).values({ user_id: userId, module, scope_type: "global", scope_id: 0, ...payload });
}

export async function createGroup(input: { name: string; description: string | null; audience: Exclude<AccessGroupAudience, "both">; /** The company a client group belongs to. */ clientId?: number | null }) {
  await dbReady;
  const [row] = await db
    .insert(schema.access_groups)
    .values({ name: input.name, description: input.description, audience: input.audience, all_clients: input.audience === "external" ? 0 : 1, client_id: input.clientId ?? null })
    .returning();
  // A client group's pages and actions are its own from the start: nothing is given until it is set.
  if (input.audience === "external") await writeGroupFlags(row.id, "client_rights", { can_view: true, can_create: false, can_edit: false, can_delete: false });
  return row;
}

/** A group and everything it carried: rights, projects, folder levels, report access and memberships. */
export async function deleteGroup(groupId: number) {
  await dbReady;
  await db.delete(schema.access_group_permissions).where(eq(schema.access_group_permissions.group_id, groupId));
  await db.delete(schema.access_group_clients).where(eq(schema.access_group_clients.group_id, groupId));
  await db.delete(schema.group_projects).where(eq(schema.group_projects.group_id, groupId));
  await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.group_id, groupId));
  await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.group_id, groupId));
  await clearReportAccessFor("group", [groupId]);
  await db.delete(schema.access_groups).where(eq(schema.access_groups.id, groupId));
}

export async function setGroupProjects(groupId: number, projectIds: number[]) {
  await dbReady;
  const existing = await db.select().from(schema.group_projects).where(eq(schema.group_projects.group_id, groupId));
  const want = new Set(projectIds);
  for (const row of existing) if (!want.has(row.project_id)) await db.delete(schema.group_projects).where(eq(schema.group_projects.id, row.id));
  const have = new Set(existing.map((r) => r.project_id));
  for (const id of want) if (!have.has(id)) await db.insert(schema.group_projects).values({ group_id: groupId, project_id: id });
}

export async function setGroupMembers(groupId: number, userIds: number[], candidates: number[]) {
  await dbReady;
  const existing = await db.select().from(schema.user_access_groups).where(eq(schema.user_access_groups.group_id, groupId));
  const want = new Set(userIds);
  for (const row of existing) if (candidates.includes(row.user_id) && !want.has(row.user_id)) await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.id, row.id));
  const have = new Set(existing.map((r) => r.user_id));
  for (const id of want) if (!have.has(id)) await db.insert(schema.user_access_groups).values({ user_id: id, group_id: groupId });
}

/** Who a document right is for: an employee (clientId 0 + userId), a company (userId null), a client user, or a group. */
export type DocSubject = { clientId: number; userId: number | null; groupId?: number | null };

export async function setDocLevel(subject: DocSubject, itemId: string, level: DocLevel) {
  await setShareFlags({ folderId: 0, clientId: subject.clientId, userId: subject.userId, groupId: subject.groupId ?? null, itemId, flags: levelFlags(level) });
}

export async function clearDocLevel(subject: DocSubject, itemId: string) {
  await clearShareFlags({ folderId: 0, clientId: subject.clientId, userId: subject.userId, groupId: subject.groupId ?? null, itemId });
}

/** The ids of every project belonging to these companies. */
export async function projectsOfClients(clientIds: number[]) {
  if (clientIds.length === 0) return [] as number[];
  const rows = await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.client_id, clientIds));
  return rows.map((r) => r.id);
}

/**
 * A client user belongs to one company at a time. Moving them (or taking them out of any company, `companyId` null) clears what
 * was tied to the old company: its projects and the folder levels set for them there. Their groups stay.
 */
export async function moveUserToCompany(userId: number, companyId: number | null) {
  await dbReady;
  const links = await db.select().from(schema.client_users).where(eq(schema.client_users.user_id, userId));
  if (links.length === 1 && links[0].client_id === companyId) return;
  const oldIds = links.map((l) => l.client_id);
  if (oldIds.length) {
    const oldProjects = await projectsOfClients(oldIds);
    if (oldProjects.length) await db.delete(schema.project_members).where(and(eq(schema.project_members.user_id, userId), inArray(schema.project_members.project_id, oldProjects)));
    await db.delete(schema.sharepoint_shares).where(and(eq(schema.sharepoint_shares.user_id, userId), inArray(schema.sharepoint_shares.client_id, oldIds)));
    await db.delete(schema.client_users).where(eq(schema.client_users.user_id, userId));
  }
  if (companyId) await db.insert(schema.client_users).values({ client_id: companyId, user_id: userId, is_primary: 0 });
}
