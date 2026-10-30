import {
  copyItem,
  createFolder,
  deleteItem,
  downloadFile,
  getGraphToken,
  getItem,
  getItemParent,
  listChildren,
  mergeSharePointConfig,
  moveItem,
  officeEditUrl,
  previewItem,
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
/**
 * What an action needs. Three levels of access: view only; view and upload; full (download, change, delete).
 * Downloading, printing and exporting need the full level, same as changing or deleting.
 */
type Need = "view" | "upload" | "download" | "edit";
const NEED_FLAG: Record<Need, keyof Grant> = { view: "view", upload: "upload", download: "edit", edit: "edit" };
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
 * Share grants of this user, one table per grantee (a client company, the user themselves, or for an employee the
 * employee only), keyed by SharePoint item id ("" = whole library root). Nobody has any right until an administrator gives it.
 */
async function loadGrants(user: ApiUser) {
  const external = user.user_type === "external";
  const { rows } = await runSql(
    `SELECT s.client_id, s.user_id, s.folder_id, s.item_id, s.can_view, s.can_upload, s.can_edit, f.sp_item_id
     FROM sharepoint_shares s
     LEFT JOIN sharepoint_folders f ON f.id = s.folder_id
     ${
       external
         ? `WHERE s.client_id IN (SELECT client_id FROM client_users WHERE user_id = $1
                                  UNION SELECT client_id FROM user_clients WHERE user_id = $1)
              AND (s.user_id IS NULL OR s.user_id = $1)`
         : "WHERE s.client_id = 0 AND s.user_id = $1"
     }`,
    [user.id],
  );
  const subjects = new Map<string, Map<string, Grant>>();
  for (const [clientId, userId, folderId, itemId, canView, canUpload, canEdit, spItemId] of rows as unknown[][]) {
    const key = String(itemId || "") || (Number(folderId) === 0 ? "" : String(spItemId || ""));
    if (!key && Number(folderId) !== 0) continue;
    const who = `${clientId}:${userId ?? ""}`;
    const nodes = subjects.get(who) ?? new Map<string, Grant>();
    const prev = nodes.get(key) ?? { view: false, upload: false, edit: false };
    nodes.set(key, {
      view: prev.view || Number(canView) === 1,
      upload: prev.upload || Number(canUpload) === 1,
      edit: prev.edit || Number(canEdit) === 1,
    });
    subjects.set(who, nodes);
  }
  return subjects;
}

type Subjects = Map<string, Map<string, Grant>>;
const isAdminUser = (user: ApiUser) => isEffectiveAdmin(user) || Number(user.is_admin) === 1;

/** The item and its ancestors up to the library root (written ""), nearest first. */
async function chainOf(token: string, driveId: string, itemId: string | undefined) {
  const chain: string[] = [];
  let current = itemId;
  for (let depth = 0; current && depth < 32; depth += 1) {
    chain.push(current);
    current = await getItemParent(token, driveId, current);
  }
  chain.push("");
  return chain;
}

/**
 * Does this person have the right on the item whose ancestry is `chain`? For each grantee the nearest folder with a right
 * set decides (so a subfolder can take rights away); a client user's right can lower their company's, never go above it.
 * Nobody has any right until an administrator gave it.
 */
function granted(subjects: Subjects, chain: string[], need: Need) {
  if (subjects.size === 0) return false;
  const hitOf = (nodes: Map<string, Grant> | undefined): Grant | null => {
    for (const key of chain) {
      const grant = nodes?.get(key);
      if (grant) return grant;
    }
    return null;
  };
  const flag = NEED_FLAG[need];
  const rank = (g: Grant | null) => (g?.edit ? 3 : g?.upload ? 2 : g?.view ? 1 : 0);
  const needRank = flag === "edit" ? 3 : flag === "upload" ? 2 : 1;
  const clientIds = new Set([...subjects.keys()].map((k) => k.split(":")[0]));
  for (const clientId of clientIds) {
    const company = hitOf(subjects.get(`${clientId}:`));
    const own = hitOf([...subjects.entries()].find(([k]) => k.startsWith(`${clientId}:`) && k !== `${clientId}:`)?.[1]);
    if (clientId === "0") {
      if (rank(own) >= needRank) return true;
      continue;
    }
    if (!own) {
      if (rank(company) >= needRank) return true;
      continue;
    }
    if (Math.min(rank(own), rank(company)) >= needRank) return true;
  }
  return false;
}

async function allowed(
  user: ApiUser,
  token: string,
  driveId: string,
  itemId: string | undefined,
  need: Need,
) {
  if (isAdminUser(user)) return true;
  const subjects = await loadGrants(user);
  if (subjects.size === 0) return false;
  return granted(subjects, await chainOf(token, driveId, itemId), need);
}

/**
 * A folder carries everything inside it. Deleting, moving or copying one needs the same right on every subfolder, so a
 * subfolder that was closed to this person can't be taken along, copied out of its protection or wiped.
 */
async function subtreeAllowed(user: ApiUser, token: string, driveId: string, itemId: string, need: Need) {
  if (isAdminUser(user)) return true;
  const item = await getItem(token, driveId, itemId);
  if (!item.folder) return true;
  const subjects = await loadGrants(user);
  const queue: string[][] = [await chainOf(token, driveId, itemId)];
  let seen = 0;
  while (queue.length) {
    const chain = queue.shift() as string[];
    for (const kid of await listChildren(token, driveId, chain[0])) {
      if (!kid.folder) continue;
      seen += 1;
      const next = [kid.id, ...chain];
      if (seen > 300 || !granted(subjects, next, need)) return false;
      queue.push(next);
    }
  }
  return true;
}

export default async function handler(req: Req, res: Res) {
  try {
    const user = await requireApiUser(req);
    if (!user) return res.status(401).json({ error: "err.unauthorized" });

    const action = String(req.body?.action ?? q(req, "action") ?? "");
    if (req.method === "GET" && action === "download") {
      const cfg = await storedConfig();
      if (!sharePointConfigured(cfg)) return res.status(400).json({ error: "sp.error.notConfigured" });
      const token = await getGraphToken(cfg);
      const driveId = String(q(req, "driveId") || "") || (await resolveDrive(token, cfg));
      const itemId = String(q(req, "itemId") ?? "");
      if (!itemId) return res.status(400).json({ error: "err.badRequest" });
      if (!validIds(driveId, itemId)) return res.status(400).json({ error: "err.badRequest" });
      if (!(await driveAllowed(user, driveId, () => resolveDrive(token, cfg)))) return res.status(403).json({ error: "err.forbidden" });
      if (!(await allowed(user, token, driveId, itemId, "download"))) return res.status(403).json({ error: "err.forbidden" });
      const name = String(q(req, "name") ?? "file");
      const asPdf = String(q(req, "format") ?? "") === "pdf";
      const inline = String(q(req, "inline") ?? "") === "1";
      const { buf, contentType } = await downloadFile(token, driveId, itemId, asPdf ? "pdf" : undefined);
      res.setHeader("Content-Type", contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      if (inline) {
        // Shown in the portal's own viewer: allow same-origin framing for this response only.
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'");
      }
      res.status(200);
      return res.end(buf);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "err.badRequest" });
    }

    const body = req.body ?? {};
    const admin = isEffectiveAdmin(user);
    const cfg =
      action === "test" && admin
        ? withOverrides(await storedConfig(), body.config as SharePointConfig | undefined)
        : await storedConfig();
    if (action === "test" && !admin) return res.status(403).json({ error: "err.forbidden" });
    if (!sharePointConfigured(cfg)) {
      if (action === "list") {
        return res.status(200).json({ configured: false, driveId: "", items: [] });
      }
      return res.status(400).json({
        error: "sp.error.notConfigured",
      });
    }
    const token = await getGraphToken(cfg);
    const driveId = String(body.driveId || "") || (await resolveDrive(token, cfg));
    const deny = () => res.status(403).json({ error: "err.forbidden" });
    const idFields = ["itemId", "parentId"].map((k) => (body[k] == null ? undefined : String(body[k])));
    if (!validIds(driveId, ...idFields)) return res.status(400).json({ error: "err.badRequest" });
    if (!(await driveAllowed(user, driveId, () => resolveDrive(token, cfg)))) return deny();

    if (action === "test") {
      await listChildren(token, driveId);
      return res.status(200).json({ ok: true, driveId });
    }
    if (action === "list") {
      const itemId = body.itemId ? String(body.itemId) : undefined;
      const admin = isAdminUser(user);
      const subjects = admin ? null : await loadGrants(user);
      const chain = admin ? [] : await chainOf(token, driveId, itemId);
      if (subjects && !granted(subjects, chain, "view")) return deny();
      // Folders closed to this person are not even named, and the SharePoint links go only to those who may download.
      const links = !subjects || granted(subjects, chain, "download");
      const items = (await listChildren(token, driveId, itemId)).filter((item) => !subjects || !item.folder || granted(subjects, [item.id, ...chain], "view"));
      return res.status(200).json({
        driveId,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          webUrl: links ? (item.webUrl ?? "") : "",
          lastModified: item.lastModifiedDateTime ?? "",
          isFolder: Boolean(item.folder),
          mime: item.file?.mimeType ?? "",
          editUrl: links && item.file ? officeEditUrl(item.webUrl) : null,
        })),
      });
    }
    if (action === "stat") {
      const itemId = String(body.itemId ?? "").trim();
      if (!itemId) return res.status(400).json({ error: "err.badRequest" });
      if (!(await allowed(user, token, driveId, itemId, "view"))) return deny();
      const item = await getItem(token, driveId, itemId);
      return res.status(200).json({ driveId, item: { id: item.id, name: item.name, isFolder: Boolean(item.folder) } });
    }
    if (action === "chain") {
      const itemId = String(body.itemId ?? "").trim();
      if (!itemId) return res.status(400).json({ error: "err.badRequest" });
      if (!(await allowed(user, token, driveId, itemId, "view"))) return deny();
      return res.status(200).json({ driveId, chain: (await chainOf(token, driveId, itemId)).filter(Boolean) });
    }
    if (action === "preview") {
      const itemId = String(body.itemId ?? "").trim();
      if (!itemId) return res.status(400).json({ error: "err.badRequest" });
      if (!(await allowed(user, token, driveId, itemId, "view"))) return deny();
      return res.status(200).json({ url: await previewItem(token, driveId, itemId) });
    }
    if (action === "mkdir") {
      const name = String(body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "sp.error.folderName" });
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
      if (!itemId || !name) return res.status(400).json({ error: "err.badRequest" });
      if (!(await allowed(user, token, driveId, itemId, "edit"))) return deny();
      const item = await renameItem(token, driveId, itemId, name);
      return res.status(200).json({ item: { id: item.id, name: item.name } });
    }
    if (action === "delete") {
      const itemId = String(body.itemId ?? "").trim();
      if (!itemId) return res.status(400).json({ error: "err.badRequest" });
      if (!(await allowed(user, token, driveId, itemId, "edit"))) return deny();
      if (!(await subtreeAllowed(user, token, driveId, itemId, "edit"))) return deny();
      await deleteItem(token, driveId, itemId);
      return res.status(200).json({ ok: true });
    }
    if (action === "copy" || action === "move") {
      const itemId = String(body.itemId ?? "").trim();
      const parentId = String(body.parentId ?? "").trim();
      if (!itemId || !parentId) return res.status(400).json({ error: "err.badRequest" });
      const sourceNeed: Need = action === "move" ? "edit" : "download";
      if (!(await allowed(user, token, driveId, itemId, sourceNeed))) return deny();
      if (!(await subtreeAllowed(user, token, driveId, itemId, sourceNeed))) return deny();
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
      // An empty body is allowed only when asked for (a new blank document).
      if (!name || (!content && body.blank !== true)) return res.status(400).json({ error: "err.badRequest" });
      if (/[\\/]|^\.\.?$/.test(name)) return res.status(400).json({ error: "sp.error.badFileName" });
      if (!(await allowed(user, token, driveId, parentId, "upload"))) return deny();
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > 4 * 1024 * 1024) {
        return res.status(400).json({ error: "sp.error.tooBig" });
      }
      const replace = await allowed(user, token, driveId, parentId || undefined, "edit");
      const file = await uploadSmallFile(token, driveId, parentId, name, bytes, replace);
      return res.status(200).json({
        file: {
          id: file.id,
          name: file.name,
          webUrl: file.webUrl ?? "",
          editUrl: officeEditUrl(file.webUrl),
        },
      });
    }
    return res.status(400).json({ error: "err.badRequest" });
  } catch (err) {
    console.error("sharepoint api error", err);
    return res.status(500).json({ error: `sp.error.failed|${err instanceof Error ? err.message : "?"}` });
  }
}
