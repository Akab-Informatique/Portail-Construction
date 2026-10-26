import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { downloadBlob } from "@/lib/download";
import { formatDate } from "@/lib/format";
import {
  callSharePoint,
  canManageLibrary,
  clientHasRootShare,
  deleteFolderRecord,
  deleteItemShares,
  foldersVisibleTo,
  itemVisibleTo,
  loadAllFolders,
  loadFolderShares,
  loadProjectFolders,
  shareFor,
  upsertShare,
  type SpItem,
} from "@/lib/sharepoint";
import { getSharePointSettings, sharepointReady } from "@/lib/settings";
import { db, schema } from "../../db";
import type { Client, SharePointFolder, SharePointSettings, SharePointShare } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FolderTreeMenu, type BrowseFolder } from "@/components/project/FolderTreeMenu";

type ItemTarget = {
  kind: "folder" | "item";
  id?: number;
  itemId: string;
  driveId: string;
  name: string;
  path?: string;
};

export function SharePointLibrary({
  projectId,
  projectName: _projectName,
  client,
  canCreate,
  compact = false,
  scopeProjectIds,
}: {
  projectId: number;
  projectName: string;
  client: Client | null;
  canCreate: boolean;
  compact?: boolean;
  scopeProjectIds?: number[];
}) {
  const { user } = useAuth();
  const { t, locale, tr } = useI18n();
  const { clients } = useWorkspace();
  const manager = canManageLibrary(user);
  // An employee: no company shares involved, they read the folders of the projects they are assigned to.
  const staff = Boolean(user && user.user_type === "internal" && !user.is_admin && user.view_as !== "client");
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [folders, setFolders] = useState<SharePointFolder[]>([]);
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [browse, setBrowse] = useState<{ id: string; name: string } | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<SpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [folderDialog, setFolderDialog] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [accessOpen, setAccessOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ folderId: number; itemId: string; name: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<ItemTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ItemTarget | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [transfer, setTransfer] = useState<"move" | "copy" | null>(null);
  const [destId, setDestId] = useState("");

  const libraryRoot: BrowseFolder | null = settings
    ? { id: 0, name: t("sp.wholeLibrary"), sp_item_id: "", sp_drive_id: settings.drive_id, path: "/" }
    : null;

  const visible = useMemo(() => {
    if (staff) {
      const mine = new Set(scopeProjectIds ?? []);
      return folders.filter((f) => (projectId !== 0 ? f.project_id === projectId : mine.has(f.project_id)));
    }
    const list = foldersVisibleTo(folders, shares, user, client?.id ?? null);
    if (projectId !== 0) return list;
    if (manager && scopeProjectIds && scopeProjectIds.length > 0 && client) {
      const allowed = new Set(scopeProjectIds);
      const scoped = list.filter((f) => allowed.has(f.project_id) || f.project_id === 0);
      return scoped.length > 0 ? scoped : list;
    }
    return list;
  }, [folders, shares, user, client, projectId, scopeProjectIds, manager, staff]);
  const showRoot = Boolean(
    libraryRoot &&
      projectId === 0 &&
      user?.is_admin &&
      user.view_as !== "client",
  );
  const showRootForClient = Boolean(libraryRoot && clientHasRootShare(shares, client?.id ?? null) && projectId === 0);
  const navFolders: BrowseFolder[] =
    projectId !== 0 ? visible : showRoot && libraryRoot ? [libraryRoot, ...visible] : showRootForClient && libraryRoot ? [libraryRoot, ...visible] : visible;
  const active = navFolders.find((f) => f.id === activeId) ?? navFolders[0] ?? null;
  const folderShare = active && active.id && client ? shareFor(shares, active.id, client.id, "") : null;
  const canUpload = Boolean(manager || (staff && canCreate && active && active.id !== 0) || (canCreate && folderShare?.can_upload && active && active.id !== 0));
  const canEditFolder = Boolean(manager || folderShare?.can_edit);
  const crumbs = [{ id: "", name: active?.name ?? t("project.nav.documents") }, ...trail];

  const visibleItems = useMemo(() => {
    if (!active) return [];
    if (manager || staff || active.id === 0) return items;
    return items.filter((item) => itemVisibleTo(shares, active.id, item.id, user, client?.id ?? null));
  }, [items, active, manager, staff, shares, user, client]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.company_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [clients, clientQuery]);

  const selectedItems = visibleItems.filter((item) => selected.includes(item.id));

  async function reloadMeta() {
    const nextFolders = projectId === 0 ? await loadAllFolders() : await loadProjectFolders(projectId);
    const nextShares = await loadFolderShares(nextFolders.map((f) => f.id));
    setFolders(nextFolders);
    setShares(nextShares);
    return { nextFolders, nextShares };
  }

  async function loadItems(folder: BrowseFolder, driveFallback?: string, itemId?: string) {
    const data = await callSharePoint<{ items: SpItem[]; driveId?: string }>("list", {
      driveId: folder.sp_drive_id || driveFallback || "",
      itemId: itemId || folder.sp_item_id || undefined,
    });
    setItems(data.items);
    if (data.driveId && settings && !settings.drive_id) {
      setSettings({ ...settings, drive_id: data.driveId });
    }
  }

  function openRoot(folder: BrowseFolder) {
    setActiveId(folder.id);
    setBrowse(null);
    setTrail([]);
    setSelected([]);
  }

  function openChild(item: SpItem) {
    if (!item.isFolder) return;
    setTrail((prev) => [...prev, { id: item.id, name: item.name }]);
    setBrowse({ id: item.id, name: item.name });
    setSelected([]);
  }

  function goToCrumb(index: number) {
    if (index <= 0) {
      setBrowse(null);
      setTrail([]);
      return;
    }
    const next = trail.slice(0, index);
    setTrail(next);
    setBrowse(next[next.length - 1] ?? null);
  }

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getSharePointSettings();
        setSettings(cfg);
        const { nextFolders, nextShares } = await reloadMeta();
        if (!sharepointReady(cfg)) {
          setItems([]);
          return;
        }
        const visibleNow = foldersVisibleTo(nextFolders, nextShares, user, client?.id ?? null);
        const first =
          projectId !== 0
            ? visibleNow[0] ?? nextFolders[0]
            : manager && libraryRoot
              ? { id: 0 as const }
              : visibleNow[0];
        if (first) setActiveId(first.id);
        setBrowse(null);
        setTrail([]);
      } catch (err) {
        setError(tr(err, "sp.error.failed"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user?.id, user?.view_as, client?.id]);

  useEffect(() => {
    setSelected([]);
  }, [active?.id, active?.sp_item_id]);

  useEffect(() => {
    if (loading || !active || !settings || !sharepointReady(settings)) return;
    void loadItems(active, settings.drive_id, browse?.id).catch((err) =>
      setError(tr(err, "sp.error.failed")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, active?.id, active?.sp_item_id, browse?.id, settings?.connected, settings?.site_url]);

  async function createLinkedFolder() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await callSharePoint<{ driveId: string; folder: { id: string; name: string } }>("mkdir", {
        name: newName.trim(),
        parentId: browse?.id || (active && active.id !== 0 ? active.sp_item_id : undefined),
      });
      const parentPath = active && active.id !== 0 ? active.path.replace(/^\//, "") : "";
      await db.insert(schema.sharepoint_folders).values({
        project_id: projectId,
        name: created.folder.name,
        sp_item_id: created.folder.id,
        sp_drive_id: created.driveId,
        path: parentPath ? `${parentPath}/${created.folder.name}` : created.folder.name,
      });
      setNewName("");
      setFolderDialog(false);
      await reloadMeta();
      if (active) await loadItems(active, settings?.drive_id, browse?.id);
    } catch (err) {
      setError(tr(err, "sp.error.createFolder"));
    } finally {
      setBusy(false);
    }
  }

  async function renameCurrent() {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await callSharePoint("rename", {
        driveId: renameTarget.driveId || settings?.drive_id,
        itemId: renameTarget.itemId,
        name: renameValue.trim(),
      });
      if (renameTarget.kind === "folder" && renameTarget.id) {
        await db
          .update(schema.sharepoint_folders)
          .set({
            name: renameValue.trim(),
            path: (renameTarget.path || renameTarget.name).replace(/[^/]+$/, renameValue.trim()),
          })
          .where(eq(schema.sharepoint_folders.id, renameTarget.id));
      }
      setRenameTarget(null);
      await reloadMeta();
      if (active) await loadItems(active, settings?.drive_id, browse?.id);
    } catch (err) {
      setError(tr(err, "sp.error.rename"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      try {
        await callSharePoint("delete", {
          driveId: deleteTarget.driveId || settings?.drive_id,
          itemId: deleteTarget.itemId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!/itemNotFound|404|does not exist|not found/i.test(message)) throw err;
      }
      if (deleteTarget.kind === "folder" && deleteTarget.id) await deleteFolderRecord(deleteTarget.id);
      else await deleteItemShares(deleteTarget.itemId);
      setDeleteTarget(null);
      setSelected((prev) => prev.filter((id) => id !== deleteTarget.itemId));
      if (deleteTarget.kind === "folder" && deleteTarget.id === active?.id) {
        setActiveId(navFolders[0]?.id ?? 0);
        setBrowse(null);
        setTrail([]);
      }
      await reloadMeta();
      if (active) await loadItems(active, settings?.drive_id, browse?.id);
    } catch (err) {
      setError(tr(err, "sp.error.delete"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (selectedItems.length === 1) {
      const item = selectedItems[0];
      const linked = folders.find((f) => f.sp_item_id === item.id);
      setDeleteTarget({
        kind: item.isFolder ? "folder" : "item",
        id: linked?.id,
        itemId: item.id,
        driveId: active?.sp_drive_id || settings?.drive_id || "",
        name: item.name,
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const item of selectedItems) {
        try {
          await callSharePoint("delete", { driveId: active?.sp_drive_id || settings?.drive_id, itemId: item.id });
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (!/itemNotFound|404|does not exist|not found/i.test(message)) throw err;
        }
        const linked = folders.find((f) => f.sp_item_id === item.id);
        if (linked) await deleteFolderRecord(linked.id);
        else await deleteItemShares(item.id);
      }
      setSelected([]);
      await reloadMeta();
      if (active) await loadItems(active);
    } catch (err) {
      setError(tr(err, "sp.error.delete"));
    } finally {
      setBusy(false);
    }
  }

  async function runTransfer() {
    if (!transfer || !active) return;
    const parentId = destId || (transfer === "copy" ? active.sp_item_id : "");
    if (transfer === "move" && !parentId) {
      setError(t("sp.pickDestination"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const item of selectedItems) {
        if (transfer === "copy") {
          await callSharePoint("copy", {
            driveId: active.sp_drive_id || settings?.drive_id,
            itemId: item.id,
            parentId: parentId || undefined,
          });
        } else {
          await callSharePoint("move", {
            driveId: active.sp_drive_id || settings?.drive_id,
            itemId: item.id,
            parentId,
          });
        }
      }
      setTransfer(null);
      setSelected([]);
      await reloadMeta();
      if (active) await loadItems(active);
    } catch (err) {
      setError(tr(err, "sp.error.transfer"));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(file: File) {
    if (!active) return;
    const parentId = browse?.id || (active.id !== 0 ? active.sp_item_id : "");
    if (!parentId) {
      setError(t("sp.pickFolder"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      await callSharePoint("upload", {
        driveId: active.sp_drive_id || settings?.drive_id,
        parentId,
        name: file.name,
        content: btoa(binary),
      });
      await loadItems(active, settings?.drive_id, browse?.id);
    } catch (err) {
      setError(tr(err, "sp.error.upload"));
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(item: SpItem) {
    if (!active) return;
    const settingsNow = settings ?? (await getSharePointSettings());
    const params = new URLSearchParams({
      action: "download",
      driveId: active.sp_drive_id || settingsNow.drive_id,
      itemId: item.id,
      name: item.name,
      tenant_id: settingsNow.tenant_id,
      client_id: settingsNow.client_id,
      site_url: settingsNow.site_url,
      drive_id: active.sp_drive_id || settingsNow.drive_id,
    });
    const res = await fetch(`/api/sharepoint?${params.toString()}`);
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(tr(payload.error, "sp.error.download"));
      return;
    }
    downloadBlob(await res.blob(), item.name);
  }

  function openShare(folderId: number, itemId: string, name: string) {
    setShareTarget({ folderId, itemId, name });
    setShareOpen(true);
  }

  async function setFlags(
    folderId: number,
    clientId: number,
    itemId: string,
    key: "can_view" | "can_upload" | "can_edit",
    on: boolean,
    current: SharePointShare | null,
  ) {
    const next = {
      can_view: key === "can_view" ? on : Boolean(current?.can_view) || on,
      can_upload: itemId ? false : key === "can_upload" ? on : Boolean(current?.can_upload),
      can_edit: key === "can_edit" ? on : Boolean(current?.can_edit),
    };
    if (next.can_upload || next.can_edit) next.can_view = true;
    if (!on && key === "can_view") {
      next.can_upload = false;
      next.can_edit = false;
    }
    await upsertShare(folderId, clientId, next, itemId);
    setShares(await loadFolderShares(folders.map((f) => f.id)));
  }

  async function clearFlags(folderId: number, clientId: number, itemId: string) {
    await upsertShare(folderId, clientId, { can_view: false, can_upload: false, can_edit: false }, itemId);
    setShares(await loadFolderShares(folders.map((f) => f.id)));
  }

  function asTarget(folder: BrowseFolder): ItemTarget {
    return {
      kind: "folder",
      id: folder.id || undefined,
      itemId: folder.sp_item_id,
      driveId: folder.sp_drive_id,
      name: folder.name,
      path: folder.path,
    };
  }

  function toggleSelected(id: string, on: boolean) {
    setSelected((prev) => (on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("sp.loading")}</p>;
  if (!settings || !sharepointReady(settings)) {
    return (
      <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />
    );
  }

  const accessFolderId = shareTarget?.folderId ?? active?.id ?? 0;
  const accessItemId = shareTarget?.itemId ?? "";
  const accessName = shareTarget?.name ?? active?.name ?? t("sp.wholeLibrary");
  const sharedCount = clients.filter((c) => Boolean(shareFor(shares, accessFolderId, c.id, accessItemId)?.can_view)).length;

  const currentTitle = browse?.name || active?.name || t("project.nav.documents");
  const canMakeHere = Boolean(manager || canUpload);

  return (
    <div className="space-y-3">
      {manager && !compact ? (
        <Card className="gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              onClick={() => setAccessOpen((open) => !open)}
              aria-expanded={accessOpen || Boolean(clientQuery.trim())}
            >
              <ChevronDown
                className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                  accessOpen || clientQuery.trim() ? "" : "-rotate-90"
                }`}
              />
              <span className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("sp.accessPanel")}</p>
                <p className="mt-1 text-sm font-medium">{accessName}</p>
                <p className="text-xs text-muted-foreground">
                  {accessItemId ? t("sp.accessThisFile") : t("sp.accessThisFolder")} · {t("sp.sharedWith", { n: sharedCount })}
                </p>
              </span>
            </button>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  if (e.target.value.trim()) setAccessOpen(true);
                }}
                onFocus={() => setAccessOpen(true)}
                placeholder={t("sp.searchClients")}
              />
            </div>
          </div>
          {accessOpen || clientQuery.trim() ? filteredClients.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("sp.noClients")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t("nav.clients")}</th>
                    <th className="py-2 px-2 font-medium">{t("sp.canView")}</th>
                    <th className="py-2 px-2 font-medium">{t("sp.canUpload")}</th>
                    <th className="py-2 px-2 font-medium">{t("sp.canEdit")}</th>
                    <th className="py-2 pl-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((c) => {
                    const share = shareFor(shares, accessFolderId, c.id, accessItemId);
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <p className="truncate font-medium">{c.company_name}</p>
                          <p className="text-xs text-muted-foreground">{c.name}</p>
                        </td>
                        {(
                          [
                            ["can_view", false],
                            ["can_upload", Boolean(accessItemId)],
                            ["can_edit", false],
                          ] as const
                        ).map(([key, disabled]) => (
                          <td key={key} className="px-2 py-2">
                            <Switch
                              checked={Boolean(share?.[key])}
                              disabled={disabled}
                              onCheckedChange={(on) => void setFlags(accessFolderId, c.id, accessItemId, key, on, share)}
                            />
                          </td>
                        ))}
                        <td className="py-2 pl-2 text-right">
                          {share?.can_view ? (
                            <Button size="sm" variant="ghost" onClick={() => void clearFlags(accessFolderId, c.id, accessItemId)}>
                              {t("sp.clearAccess")}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}
      <div>
        <Card className="mb-3 gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <FolderTreeMenu
              folders={showRoot && libraryRoot ? [libraryRoot] : navFolders}
              driveId={settings.drive_id}
              currentKey={browse?.id || active?.sp_item_id || `db-${active?.id ?? 0}`}
              onOpen={(root, nextTrail) => {
                if (nextTrail.length === 0) {
                  openRoot(root);
                  return;
                }
                setActiveId(root.id);
                setTrail(nextTrail);
                setBrowse(nextTrail[nextTrail.length - 1] ?? null);
                setSelected([]);
              }}
            />
            <Button size="sm" variant="outline" disabled={trail.length === 0} onClick={() => goToCrumb(trail.length - 1)}>
              {t("sp.up")}
            </Button>
            <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.id}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" /> : null}
                  <button type="button" className="max-w-[10rem] truncate hover:text-primary" onClick={() => goToCrumb(index)}>
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canMakeHere ? (
              <Button size="sm" onClick={() => setFolderDialog(true)} disabled={busy}>
                <FolderPlus className="size-4" />
                {t("sp.newFolder")}
              </Button>
            ) : null}
            {canMakeHere ? (
              <Button size="sm" variant="outline" asChild disabled={busy}>
                <label className="cursor-pointer">
                  <Upload className="size-4" />
                  {t("sp.uploadHere")}
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Button>
            ) : null}
            {manager && active ? (
              <Button size="sm" variant="outline" onClick={() => openShare(active.id, "", currentTitle)}>
                <Share2 className="size-4" />
                {t("sp.shareFolder")}
              </Button>
            ) : null}
            {manager && active && active.id !== 0 && !browse ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRenameTarget(asTarget(active));
                    setRenameValue(active.name);
                  }}
                >
                  <Pencil className="size-4" />
                  {t("sp.rename")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeleteTarget(asTarget(active))}>
                  <Trash2 className="size-4" />
                  {t("sp.delete")}
                </Button>
              </>
            ) : null}
          </div>
        </Card>
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        {manager ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(selected.length === visibleItems.length ? [] : visibleItems.map((i) => i.id))}
            >
              <CheckSquare className="size-4" />
              {t("sp.selectAll")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("sp.selected", { n: selected.length })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedItems.length !== 1}
              onClick={() => {
                const item = selectedItems[0];
                const linked = folders.find((f) => f.sp_item_id === item.id);
                setRenameTarget({
                  kind: item.isFolder ? "folder" : "item",
                  id: linked?.id,
                  itemId: item.id,
                  driveId: active?.sp_drive_id || settings.drive_id,
                  name: item.name,
                  path: linked?.path,
                });
                setRenameValue(item.name);
              }}
            >
              <Pencil className="size-4" />
              {t("sp.rename")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selected.length === 0}
              onClick={() => {
                setDestId("");
                setTransfer("move");
              }}
            >
              <FolderInput className="size-4" />
              {t("sp.move")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selected.length === 0}
              onClick={() => {
                setDestId(active?.sp_item_id || "");
                setTransfer("copy");
              }}
            >
              <Copy className="size-4" />
              {t("sp.copy")}
            </Button>
            <Button size="sm" variant="destructive" disabled={selected.length === 0 || busy} onClick={() => void deleteSelected()}>
              <Trash2 className="size-4" />
              {t("sp.delete")}
            </Button>
          </div>
        ) : null}
        {!active ? (
          <EmptyState icon={<FileText className="size-5" />} title={t("sp.pickFolder")} description="" />
        ) : visibleItems.length === 0 ? (
          <EmptyState icon={<FileText className="size-5" />} title={t("sp.emptyFolder")} description={t("sp.emptyFolderHint")} />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {visibleItems.map((item) => {
              const fileShare = active.id && client ? shareFor(shares, active.id, client.id, item.id) : null;
              const canEdit = Boolean(manager || fileShare?.can_edit || canEditFolder);
              const linked = folders.find((f) => f.sp_item_id === item.id);
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {manager ? (
                    <Checkbox
                      checked={selected.includes(item.id)}
                      onCheckedChange={(on) => toggleSelected(item.id, Boolean(on))}
                      aria-label={t("sp.select")}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (item.isFolder && linked) setActiveId(linked.id);
                      else if (manager) toggleSelected(item.id, !selected.includes(item.id));
                    }}
                  >
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.isFolder ? t("sp.folder") : `${Math.max(1, Math.round(item.size / 1024))} KB`}
                      {item.lastModified ? ` · ${formatDate(item.lastModified, locale)}` : ""}
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {item.isFolder ? (
                      <Button size="sm" variant="ghost" onClick={() => openChild(item)}>
                        {t("sp.openFolder")}
                        <ChevronRight className="size-4" />
                      </Button>
                    ) : null}
                    {manager ? (
                      <Button size="sm" variant="outline" onClick={() => openShare(active.id, item.isFolder ? "" : item.id, item.name)}>
                        <Share2 className="size-4" />
                        {item.isFolder ? t("sp.shareFolder") : t("sp.shareFile")}
                      </Button>
                    ) : null}
                    {!item.isFolder ? (
                      <Button size="sm" variant="outline" onClick={() => void onDownload(item)}>
                        <Download className="size-4" />
                        {t("sp.download")}
                      </Button>
                    ) : null}
                    {canEdit && item.editUrl ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={item.editUrl} target="_blank" rel="noreferrer">
                          {t("sp.edit")}
                        </a>
                      </Button>
                    ) : null}
                    {manager ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRenameTarget({
                              kind: item.isFolder ? "folder" : "item",
                              id: linked?.id,
                              itemId: item.id,
                              driveId: active?.sp_drive_id || settings.drive_id,
                              name: item.name,
                              path: linked?.path,
                            });
                            setRenameValue(item.name);
                          }}
                        >
                          <Pencil className="size-4" />
                          {t("sp.rename")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setDeleteTarget({
                              kind: item.isFolder ? "folder" : "item",
                              id: linked?.id,
                              itemId: item.id,
                              driveId: active?.sp_drive_id || settings.drive_id,
                              name: item.name,
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                          {t("sp.delete")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={folderDialog} onOpenChange={setFolderDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sp.newFolder")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("sp.newFolderHint")}</p>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("sp.folderName")} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFolderDialog(false)}>
              {t("clients.cancel")}
            </Button>
            <Button type="button" disabled={busy || !newName.trim()} onClick={() => void createLinkedFolder()}>
              {t("sp.createHere")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{shareTarget?.itemId ? t("sp.shareFileTitle") : t("sp.shareTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("sp.sharingFor")} <span className="font-medium text-foreground">{shareTarget?.name}</span>
          </p>
          <Input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder={t("sp.searchClients")} />
          <ul className="max-h-80 space-y-3 overflow-auto">
            {filteredClients.map((c) => {
              const share = shareTarget ? shareFor(shares, shareTarget.folderId, c.id, shareTarget.itemId) : null;
              return (
                <li key={c.id} className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-medium">{c.company_name}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["can_view", t("sp.canView")],
                        ["can_upload", t("sp.canUpload")],
                        ["can_edit", t("sp.canEdit")],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-2 text-xs">
                        {label}
                        <Switch
                          checked={Boolean(share?.[key])}
                          disabled={Boolean(shareTarget?.itemId) && key === "can_upload"}
                          onCheckedChange={(on) => {
                            if (!shareTarget) return;
                            void setFlags(shareTarget.folderId, c.id, shareTarget.itemId, key, on, share);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button onClick={() => setShareOpen(false)}>{t("project.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sp.renameItemTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("sp.renameHint")}</p>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
              {t("clients.cancel")}
            </Button>
            <Button type="button" disabled={busy || !renameValue.trim()} onClick={() => void renameCurrent()}>
              {t("sp.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transfer)} onOpenChange={(open) => !open && setTransfer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{transfer === "copy" ? t("sp.copyTitle") : t("sp.moveTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("sp.pickDestination")}</p>
          <ul className="max-h-72 space-y-1 overflow-auto">
            {transfer === "copy" ? (
              <li>
                <button
                  type="button"
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${!destId || destId === active?.sp_item_id ? "bg-primary/12 font-medium" : "hover:bg-muted"}`}
                  onClick={() => setDestId(active?.sp_item_id || "")}
                >
                  {t("sp.copyHere")}
                </button>
              </li>
            ) : null}
            {navFolders
              .filter((folder) => folder.sp_item_id && folder.sp_item_id !== active?.sp_item_id)
              .map((folder) => (
                <li key={folder.sp_item_id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                      destId === folder.sp_item_id ? "bg-primary/12 font-medium" : "hover:bg-muted"
                    }`}
                    onClick={() => setDestId(folder.sp_item_id)}
                  >
                    <FolderOpen className="size-3.5 opacity-70" />
                    {folder.name}
                  </button>
                </li>
              ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransfer(null)}>
              {t("clients.cancel")}
            </Button>
            <Button type="button" disabled={busy || (transfer === "move" && !destId)} onClick={() => void runTransfer()}>
              {transfer === "copy" ? t("sp.copy") : t("sp.move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sp.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("sp.deleteHint", { name: deleteTarget?.name ?? "" })}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("clients.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void deleteCurrent()}>
              {t("sp.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
