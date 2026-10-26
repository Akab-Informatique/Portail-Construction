import { and, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { EMPTY_SHAREPOINT, getSharePointSettings } from "./settings";
import type { SessionUser, SharePointFolder, SharePointSettings, SharePointShare } from "./types";

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

export async function loadFolderShares(folderIds: number[]) {
  await dbReady;
  const all = (await db.select().from(schema.sharepoint_shares)) as SharePointShare[];
  if (folderIds.length === 0) return all.filter((s) => s.folder_id === 0);
  return all.filter((s) => folderIds.includes(s.folder_id) || s.folder_id === 0);
}

function shareIsOn(value: unknown) {
  return Number(value) === 1 || value === true;
}

export function foldersVisibleTo(
  folders: SharePointFolder[],
  shares: SharePointShare[],
  user: SessionUser | null,
  clientId: number | null,
) {
  if (!user) return [];
  if (user.is_admin && user.view_as !== "client") return folders;
  const matches = shares.filter((s) => shareIsOn(s.can_view) && s.folder_id !== 0 && (!clientId || s.client_id === clientId));
  const allowed = new Set(matches.map((s) => s.folder_id));
  return folders.filter((f) => allowed.has(f.id));
}

export function clientHasRootShare(shares: SharePointShare[], clientId: number | null) {
  if (!clientId) return false;
  return shares.some((s) => s.client_id === clientId && s.folder_id === 0 && shareIsOn(s.can_view));
}

export function shareFor(
  shares: SharePointShare[],
  folderId: number,
  clientId: number | null,
  itemId = "",
) {
  if (!clientId) return null;
  return (
    shares.find((s) => s.folder_id === folderId && s.client_id === clientId && (s.item_id || "") === itemId) ?? null
  );
}

export function itemVisibleTo(
  shares: SharePointShare[],
  folderId: number,
  itemId: string,
  user: SessionUser | null,
  clientId: number | null,
) {
  if (canManageLibrary(user)) return true;
  if (!clientId) return false;
  const fileShare = shareFor(shares, folderId, clientId, itemId);
  if (fileShare) return Boolean(fileShare.can_view);
  if (folderId === 0) {
    const root = shareFor(shares, 0, clientId, "");
    return Boolean(root?.can_view);
  }
  const folderShare = shareFor(shares, folderId, clientId, "");
  return Boolean(folderShare?.can_view);
}

export async function upsertShare(
  folderId: number,
  clientId: number,
  flags: { can_view: boolean; can_upload: boolean; can_edit: boolean },
  itemId = "",
) {
  await dbReady;
  const existing = await db
    .select()
    .from(schema.sharepoint_shares)
    .where(and(eq(schema.sharepoint_shares.folder_id, folderId), eq(schema.sharepoint_shares.client_id, clientId)));
  const row = existing.find((s) => (s.item_id || "") === itemId);
  const payload = {
    can_view: flags.can_view ? 1 : 0,
    can_upload: flags.can_upload ? 1 : 0,
    can_edit: flags.can_edit ? 1 : 0,
    item_id: itemId,
  };
  if (row) {
    await db.update(schema.sharepoint_shares).set(payload).where(eq(schema.sharepoint_shares.id, row.id));
    return;
  }
  await db.insert(schema.sharepoint_shares).values({ folder_id: folderId, client_id: clientId, ...payload });
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

export async function assignProjectFolder(opts: {
  projectId: number;
  clientId: number;
  name: string;
  spItemId: string;
  spDriveId: string;
  path: string;
}) {
  await dbReady;
  const existing = (await db
    .select()
    .from(schema.sharepoint_folders)
    .where(eq(schema.sharepoint_folders.sp_item_id, opts.spItemId))) as SharePointFolder[];
  let folder = existing[0];
  if (folder) {
    await db
      .update(schema.sharepoint_folders)
      .set({ project_id: opts.projectId, name: opts.name, path: opts.path, sp_drive_id: opts.spDriveId })
      .where(eq(schema.sharepoint_folders.id, folder.id));
    folder = { ...folder, project_id: opts.projectId, name: opts.name, path: opts.path, sp_drive_id: opts.spDriveId };
  } else {
    const [row] = await db
      .insert(schema.sharepoint_folders)
      .values({
        project_id: opts.projectId,
        name: opts.name,
        sp_item_id: opts.spItemId,
        sp_drive_id: opts.spDriveId,
        path: opts.path,
      })
      .returning();
    folder = row as SharePointFolder;
  }
  await upsertShare(folder.id, opts.clientId, { can_view: true, can_upload: false, can_edit: false });
  return folder;
}

export { EMPTY_SHAREPOINT };
