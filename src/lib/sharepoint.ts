import { and, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { EMPTY_SHAREPOINT, getSharePointSettings } from "./settings";
import type { SessionUser, SharePointFolder, SharePointSettings } from "./types";

export type SpItem = {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  lastModified: string;
  isFolder: boolean;
  mime: string;
  editUrl: string | null;
};

export function publicSharePointConfig(settings: SharePointSettings) {
  return {
    tenant_id: settings.tenant_id,
    client_id: settings.client_id,
    site_url: settings.site_url,
    drive_id: settings.drive_id,
    library_name: settings.library_name,
  };
}

export async function callSharePoint<T>(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const settings = await getSharePointSettings();
  if (!settings.tenant_id || !settings.client_id || !settings.site_url) {
    throw new Error("sp.error.notConfigured");
  }
  const res = await fetch("/api/sharepoint", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      config: publicSharePointConfig(settings),
      ...extra,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error || `sp.error.failed:${res.status}`);
  return payload;
}

export function canManageLibrary(user: SessionUser | null) {
  return Boolean(user && user.is_active && user.is_admin && user.view_as !== "client");
}

export async function loadProjectFolders(projectId: number) {
  await dbReady;
  return (await db
    .select()
    .from(schema.sharepoint_folders)
    .where(eq(schema.sharepoint_folders.project_id, projectId))) as SharePointFolder[];
}

export async function loadAllFolders() {
  await dbReady;
  return (await db.select().from(schema.sharepoint_folders)) as SharePointFolder[];
}

/** A right on one folder for a client company (userId null), a client user, or an employee (clientId 0 and their user id). */
export async function setShareFlags(input: {
  folderId: number;
  clientId: number;
  userId: number | null;
  itemId: string;
  flags: { can_view: boolean; can_upload: boolean; can_edit: boolean };
}) {
  await dbReady;
  const existing = await db
    .select()
    .from(schema.sharepoint_shares)
    .where(and(eq(schema.sharepoint_shares.folder_id, input.folderId), eq(schema.sharepoint_shares.client_id, input.clientId)));
  const row = existing.find((s) => (s.user_id ?? null) === input.userId && (s.item_id || "") === input.itemId);
  const payload = {
    can_view: input.flags.can_view ? 1 : 0,
    can_upload: input.flags.can_upload ? 1 : 0,
    can_edit: input.flags.can_edit ? 1 : 0,
  };
  if (row) await db.update(schema.sharepoint_shares).set(payload).where(eq(schema.sharepoint_shares.id, row.id));
  else await db.insert(schema.sharepoint_shares).values({ folder_id: input.folderId, client_id: input.clientId, user_id: input.userId, item_id: input.itemId, ...payload });
}

/** Back to inheriting: remove the explicit right on this folder. */
export async function clearShareFlags(input: { folderId: number; clientId: number; userId: number | null; itemId: string }) {
  await dbReady;
  const existing = await db
    .select()
    .from(schema.sharepoint_shares)
    .where(and(eq(schema.sharepoint_shares.folder_id, input.folderId), eq(schema.sharepoint_shares.client_id, input.clientId)));
  for (const row of existing.filter((s) => (s.user_id ?? null) === input.userId && (s.item_id || "") === input.itemId)) {
    await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.id, row.id));
  }
}

export async function deleteFolderRecord(folderId: number) {
  await dbReady;
  await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.folder_id, folderId));
  await db.delete(schema.sharepoint_folders).where(eq(schema.sharepoint_folders.id, folderId));
}

export async function deleteItemShares(itemId: string) {
  await dbReady;
  await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.item_id, itemId));
}

/**
 * A project has one documentation root: its first folder link. Choosing another folder replaces that link in place, and the
 * rights given on the old folder go with it (a new root starts with no access). Choosing the same folder again keeps them.
 */
export async function assignProjectFolder(opts: {
  projectId: number;
  clientId: number;
  name: string;
  spItemId: string;
  spDriveId: string;
  path: string;
}) {
  await dbReady;
  const mine = ((await db.select().from(schema.sharepoint_folders).where(eq(schema.sharepoint_folders.project_id, opts.projectId))) as SharePointFolder[])
    .filter((f) => f.sp_item_id)
    .sort((a, b) => a.id - b.id);
  const root = mine[0];
  const fields = { name: opts.name, sp_item_id: opts.spItemId, sp_drive_id: opts.spDriveId, path: opts.path };
  if (!root) {
    const [row] = await db.insert(schema.sharepoint_folders).values({ project_id: opts.projectId, ...fields }).returning();
    return row as SharePointFolder;
  }
  if (root.sp_item_id !== opts.spItemId) {
    // The old root's rights no longer describe anything; another link to the new folder under this project is dropped.
    await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.folder_id, root.id));
    for (const dup of mine.slice(1).filter((f) => f.sp_item_id === opts.spItemId)) await deleteFolderRecord(dup.id);
  }
  await db.update(schema.sharepoint_folders).set(fields).where(eq(schema.sharepoint_folders.id, root.id));
  return { ...root, ...fields } as SharePointFolder;
}

export { EMPTY_SHAREPOINT };
