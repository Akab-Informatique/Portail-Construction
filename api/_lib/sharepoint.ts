export type SharePointConfig = {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  site_url?: string;
  drive_id?: string;
  library_name?: string;
};

type GraphError = { error?: { message?: string; code?: string } };

const GRAPH = "https://graph.microsoft.com/v1.0";

export function mergeSharePointConfig(body: SharePointConfig): SharePointConfig {
  return {
    tenant_id: body.tenant_id || process.env.SHAREPOINT_TENANT_ID || "",
    client_id: body.client_id || process.env.SHAREPOINT_CLIENT_ID || "",
    client_secret: body.client_secret || process.env.SHAREPOINT_CLIENT_SECRET || "",
    site_url: body.site_url || process.env.SHAREPOINT_SITE_URL || "",
    drive_id: body.drive_id || process.env.SHAREPOINT_DRIVE_ID || "",
    library_name: body.library_name || process.env.SHAREPOINT_LIBRARY || "Documents",
  };
}

export function sharePointConfigured(cfg: SharePointConfig) {
  return Boolean(cfg.tenant_id && cfg.client_id && cfg.client_secret && cfg.site_url);
}

export async function getGraphToken(cfg: SharePointConfig): Promise<string> {
  if (!sharePointConfigured(cfg)) throw new Error("SharePoint is not configured.");
  const body = new URLSearchParams({
    client_id: cfg.client_id!,
    client_secret: cfg.client_secret!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${cfg.tenant_id}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || "Could not get a Microsoft Graph token.");
  }
  return json.access_token;
}

async function graph<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body instanceof Uint8Array ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 202 || res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) {
    throw new Error(json.error?.message || `Graph ${res.status}`);
  }
  return json;
}

function hostnameAndPath(siteUrl: string) {
  const u = new URL(siteUrl.includes("://") ? siteUrl : `https://${siteUrl}`);
  return { host: u.hostname, path: u.pathname.replace(/\/$/, "") || "/" };
}

export async function resolveDrive(token: string, cfg: SharePointConfig) {
  if (cfg.drive_id) return cfg.drive_id;
  const { host, path } = hostnameAndPath(cfg.site_url!);
  const sitePath = path === "/" ? `/sites/${host}:` : `/sites/${host}:${path}`;
  const site = await graph<{ id: string }>(token, sitePath);
  const drives = await graph<{ value: { id: string; name: string }[] }>(token, `/sites/${site.id}/drives`);
  const wanted = (cfg.library_name || "Documents").toLowerCase();
  const drive =
    drives.value.find((d) => d.name.toLowerCase() === wanted) ||
    drives.value.find((d) => d.name.toLowerCase() === "documents") ||
    drives.value[0];
  if (!drive) throw new Error("No document library found on this site.");
  return drive.id;
}

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
};

export async function listChildren(token: string, driveId: string, itemId?: string) {
  const path = itemId ? `/drives/${driveId}/items/${itemId}/children` : `/drives/${driveId}/root/children`;
  const data = await graph<{ value: DriveItem[] }>(token, `${path}?$select=id,name,size,webUrl,lastModifiedDateTime,folder,file`);
  return data.value ?? [];
}

/** Parent item id, or undefined at the drive root. */
export async function getItemParent(token: string, driveId: string, itemId: string) {
  const item = await graph<{ parentReference?: { id?: string } }>(
    token,
    `/drives/${driveId}/items/${itemId}?$select=id,parentReference`,
  );
  return item.parentReference?.id || undefined;
}

export async function createFolder(token: string, driveId: string, name: string, parentId?: string) {
  const path = parentId ? `/drives/${driveId}/items/${parentId}/children` : `/drives/${driveId}/root/children`;
  return graph<DriveItem>(token, path, {
    method: "POST",
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
  });
}

export async function renameItem(token: string, driveId: string, itemId: string, name: string) {
  return graph<DriveItem>(token, `/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteItem(token: string, driveId: string, itemId: string) {
  await graph(token, `/drives/${driveId}/items/${itemId}`, { method: "DELETE" });
}

export async function copyItem(token: string, driveId: string, itemId: string, parentId?: string, name?: string) {
  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (parentId) body.parentReference = { id: parentId };
  return graph<DriveItem>(token, `/drives/${driveId}/items/${itemId}/copy`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function moveItem(token: string, driveId: string, itemId: string, parentId: string) {
  return graph<DriveItem>(token, `/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ parentReference: { id: parentId } }),
  });
}

export async function uploadSmallFile(
  token: string,
  driveId: string,
  parentId: string,
  filename: string,
  bytes: Uint8Array,
) {
  const encoded = encodeURIComponent(filename);
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${parentId}:/${encoded}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
  const json = (await res.json().catch(() => ({}))) as DriveItem & GraphError;
  if (!res.ok) throw new Error(json.error?.message || `Upload failed (${res.status})`);
  return json;
}

export async function downloadFile(token: string, driveId: string, itemId: string) {
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as GraphError;
    throw new Error(json.error?.message || `Download failed (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { buf, contentType };
}

export function officeEditUrl(webUrl?: string) {
  if (!webUrl) return null;
  return `https://view.officeapps.live.com/op/edit.aspx?src=${encodeURIComponent(webUrl)}`;
}
