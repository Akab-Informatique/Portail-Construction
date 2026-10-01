import {
  copyItem,
  createFolder,
  deleteItem,
  downloadFile,
  getGraphToken,
  getItemParent,
  listChildren,
  mergeSharePointConfig,
  moveItem,
  officeEditUrl,
  renameItem,
  resolveDrive,
  sharePointConfigured,
  uploadSmallFile,
  type SharePointConfig,
} from "./_lib/sharepoint.js";
import { isEffectiveAdmin, readStoredSetting, requireApiUser, runSql } from "./db.ts";

type Req = {
  method?: string;
  query?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
  headers?: Record<string, unknown>;
};
type Res = {
  status: (code: number) => { json: (body: unknown) => unknown; end?: (body?: unknown) => unknown };
  json: (body: unknown) => unknown;
  setHeader: (k: string, v: string) => void;
  end: (body?: unknown) => unknown;
};
type Grant = { view: boolean; upload: boolean; edit: boolean };
type Need = keyof Grant;
type ApiUser = NonNullable<Awaited<ReturnType<typeof requireApiUser>>>;

const REDACTED = "********";
/** Graph drive/item ids are URL path segments; reject anything that could change the path. */
const GRAPH_ID = /^[A-Za-z0-9!_-]{1,200}$/;

function validIds(...ids: (string | undefined)[]) {
  return ids.every((id) => id === undefined || id === "" || GRAPH_ID.test(id));
}

/** Non-admins may only reach the configured library or drives already linked to project folders. */
async function driveAllowed(user: ApiUser, driveId: string, configuredDrive: () => Promise<string>) {
  if (isEffectiveAdmin(user) || Number(user.is_admin) === 1) return true;
  if (driveId === (await configuredDrive())) return true;
  const { rows } = await runSql("SELECT 1 FROM sharepoint_folders WHERE sp_drive_id = $1 LIMIT 1", [driveId]);
  return rows.length > 0;
}

function q(req: Req, key: string) {
  const v = req.query?.[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Saved settings (with the real secret) merged with env. Never taken from the request. */
async function storedConfig(): Promise<SharePointConfig> {
  let saved: SharePointConfig = {};
  try {
    const raw = await readStoredSetting("sharepoint");
    if (raw) saved = JSON.parse(raw) as SharePointConfig;
  } catch {
    saved = {};
  }
  return mergeSharePointConfig({ ...saved, client_secret: process.env.SHAREPOINT_CLIENT_SECRET || saved.client_secret });
}

/** Admins testing unsaved settings may override fields; the saved secret is kept unless a new one is typed. */
function withOverrides(base: SharePointConfig, override: SharePointConfig | undefined): SharePointConfig {
  if (!override) return base;
  const secret = override.client_secret && override.client_secret !== REDACTED ? override.client_secret : base.client_secret;
  return {
    tenant_id: override.tenant_id || base.tenant_id,
    client_id: override.client_id || base.client_id,
    client_secret: secret,
    site_url: override.site_url || base.site_url,
    drive_id: override.drive_id || base.drive_id,
    library_name: override.library_name || base.library_name,
  };
}

/**
 * Share grants keyed by SharePoint item id ("" = whole library root).
 * External users only get their own clients' shares; internal staff get any share.
 */
async function loadGrants(user: ApiUser) {
  const external = user.user_type === "external";
  const { rows } = await runSql(
    `SELECT s.folder_id, s.item_id, s.can_view, s.can_upload, s.can_edit, f.sp_item_id
     FROM sharepoint_shares s
     LEFT JOIN sharepoint_folders f ON f.id = s.folder_id
     ${
       external
         ? `WHERE s.client_id IN (SELECT client_id FROM client_users WHERE user_id = $1
                                  UNION SELECT client_id FROM user_clients WHERE user_id = $1)`
         : "WHERE $1::int IS NOT NULL"
     }`,
    [user.id],
  );
  const grants = new Map<string, Grant>();
  for (const [folderId, itemId, canView, canUpload, canEdit, spItemId] of rows as unknown[][]) {
    const key = String(itemId || "") || (Number(folderId) === 0 ? "" : String(spItemId || ""));
    if (!key && Number(folderId) !== 0) continue;
    const prev = grants.get(key) ?? { view: false, upload: false, edit: false };
    grants.set(key, {
      view: prev.view || Number(canView) === 1,
      upload: prev.upload || Number(canUpload) === 1,
      edit: prev.edit || Number(canEdit) === 1,
    });
  }
  return grants;
}

/** Walks up from itemId to the drive root looking for a share that grants `need`. */
async function allowed(
  user: ApiUser,
  token: string,
  driveId: string,
  itemId: string | undefined,
  need: Need,
) {
  if (isEffectiveAdmin(user) || Number(user.is_admin) === 1) return true;
  if (user.user_type !== "external" && need === "view") return true;
  const grants = await loadGrants(user);
  const ok = (key: string) => Boolean(grants.get(key)?.[need]);
  if (ok("")) return true;
  let current = itemId;
  for (let depth = 0; current && depth < 32; depth += 1) {
    if (ok(current)) return true;
    current = await getItemParent(token, driveId, current);
  }
  return false;
}

export default async function handler(req: Req, res: Res) {
  try {
    const user = await requireApiUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const action = String(req.body?.action ?? q(req, "action") ?? "");
    if (req.method === "GET" && action === "download") {
      const cfg = await storedConfig();
      if (!sharePointConfigured(cfg)) return res.status(400).json({ error: "SharePoint is not configured." });
      const token = await getGraphToken(cfg);
      const driveId = String(q(req, "driveId") || "") || (await resolveDrive(token, cfg));
      const itemId = String(q(req, "itemId") ?? "");
      if (!itemId) return res.status(400).json({ error: "itemId is required." });
      if (!validIds(driveId, itemId)) return res.status(400).json({ error: "Invalid id." });
      if (!(await driveAllowed(user, driveId, () => resolveDrive(token, cfg)))) return res.status(403).json({ error: "Forbidden" });
      if (!(await allowed(user, token, driveId, itemId, "view"))) return res.status(403).json({ error: "Forbidden" });
      const name = String(q(req, "name") ?? "file");
      const { buf, contentType } = await downloadFile(token, driveId, itemId);
      res.setHeader("Content-Type", contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      res.status(200);
      return res.end(buf);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body ?? {};
    const admin = isEffectiveAdmin(user);
    const cfg =
      action === "test" && admin
        ? withOverrides(await storedConfig(), body.config as SharePointConfig | undefined)
        : await storedConfig();
    if (action === "test" && !admin) return res.status(403).json({ error: "Forbidden" });
    if (!sharePointConfigured(cfg)) {
      if (action === "list") {
        return res.status(200).json({ configured: false, driveId: "", items: [] });
      }
      return res.status(400).json({
        error: "SharePoint is not configured. Add tenant ID, client ID, secret, and site URL under Setup → SharePoint.",
      });
    }
    const token = await getGraphToken(cfg);
    const driveId = String(body.driveId || "") || (await resolveDrive(token, cfg));
    const deny = () => res.status(403).json({ error: "Forbidden" });
    const idFields = ["itemId", "parentId"].map((k) => (body[k] == null ? undefined : String(body[k])));
    if (!validIds(driveId, ...idFields)) return res.status(400).json({ error: "Invalid id." });
    if (!(await driveAllowed(user, driveId, () => resolveDrive(token, cfg)))) return deny();

    if (action === "test") {
      await listChildren(token, driveId);
      return res.status(200).json({ ok: true, driveId });
    }
    if (action === "list") {
      const itemId = body.itemId ? String(body.itemId) : undefined;
      if (!(await allowed(user, token, driveId, itemId, "view"))) return deny();
      const items = await listChildren(token, driveId, itemId);
      return res.status(200).json({
        driveId,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          webUrl: item.webUrl ?? "",
          lastModified: item.lastModifiedDateTime ?? "",
          isFolder: Boolean(item.folder),
          mime: item.file?.mimeType ?? "",
          editUrl: item.file ? officeEditUrl(item.webUrl) : null,
        })),
      });
    }
    if (action === "mkdir") {
      const name = String(body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Folder name is required." });
      const parentId = body.parentId ? String(body.parentId) : undefined;
      if (!(await allowed(user, token, driveId, parentId, "upload"))) return deny();
      const folder = await createFolder(token, driveId, name, parentId);
      return res.status(200).json({
        driveId,
        folder: { id: folder.id, name: folder.name, webUrl: folder.webUrl ?? "" },
      });
    }
    if (action === "rename") {
      const itemId = String(body.itemId ?? "").trim();
      const name = String(body.name ?? "").trim();
      if (!itemId || !name) return res.status(400).json({ error: "itemId and name are required." });
      if (!(await allowed(user, token, driveId, itemId, "edit"))) return deny();
      const item = await renameItem(token, driveId, itemId, name);
      return res.status(200).json({ item: { id: item.id, name: item.name } });
    }
    if (action === "delete") {
      const itemId = String(body.itemId ?? "").trim();
      if (!itemId) return res.status(400).json({ error: "itemId is required." });
      if (!(await allowed(user, token, driveId, itemId, "edit"))) return deny();
      await deleteItem(token, driveId, itemId);
      return res.status(200).json({ ok: true });
    }
    if (action === "copy" || action === "move") {
      const itemId = String(body.itemId ?? "").trim();
      const parentId = String(body.parentId ?? "").trim();
      if (!itemId || !parentId) return res.status(400).json({ error: "itemId and parentId are required." });
      const sourceNeed: Need = action === "move" ? "edit" : "view";
      if (!(await allowed(user, token, driveId, itemId, sourceNeed))) return deny();
      if (!(await allowed(user, token, driveId, parentId, "upload"))) return deny();
      if (action === "copy") {
        await copyItem(token, driveId, itemId, parentId, body.name ? String(body.name) : undefined);
      } else {
        await moveItem(token, driveId, itemId, parentId);
      }
      return res.status(200).json({ ok: true });
    }
    if (action === "upload") {
      const name = String(body.name ?? "").trim();
      const parentId = String(body.parentId ?? "");
      const content = String(body.content ?? "");
      if (!name || !parentId || !content) return res.status(400).json({ error: "name, parentId, and content are required." });
      if (/[\\/]|^\.\.?$/.test(name)) return res.status(400).json({ error: "Invalid file name." });
      if (!(await allowed(user, token, driveId, parentId, "upload"))) return deny();
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > 4 * 1024 * 1024) {
        return res.status(400).json({ error: "Files over 4 MB need a larger upload session. Split or compress the file." });
      }
      const file = await uploadSmallFile(token, driveId, parentId, name, bytes);
      return res.status(200).json({
        file: {
          id: file.id,
          name: file.name,
          webUrl: file.webUrl ?? "",
          editUrl: officeEditUrl(file.webUrl),
        },
      });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("sharepoint api error", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "SharePoint error" });
  }
}
