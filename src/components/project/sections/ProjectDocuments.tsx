import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Printer,
  RefreshCw,
  Upload,
} from "lucide-react";
import { callSharePoint, loadProjectFolders, type SpItem } from "@/lib/sharepoint";
import { getSharePointSettings } from "@/lib/settings";
import { downloadBlob } from "@/lib/download";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { projectColor } from "@/lib/project-colors";
import type { SharePointFolder, SharePointSettings } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

const MAX_BYTES = 4 * 1024 * 1024;

type Crumb = { id: string; name: string };

function iconFor(item: SpItem) {
  if (item.isFolder) return Folder;
  const m = item.mime || "";
  const n = item.name.toLowerCase();
  if (m.startsWith("image/")) return FileImage;
  if (m.includes("sheet") || /\.(xlsx?|csv)$/.test(n)) return FileSpreadsheet;
  if (m.includes("pdf") || /\.(pdf|docx?|txt)$/.test(n)) return FileText;
  return FileIcon;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Documentation: the SharePoint folder chosen for this project is the root, and nothing above it can be reached.
 * Tree on the left, tools on top (upload, download, print), and the folder's files in the middle like a file explorer.
 */
export function ProjectDocuments({ project }: SectionProps) {
  const { t, locale, tr } = useI18n();
  const [params, setParams] = useSearchParams();
  const color = projectColor(project);
  const [state, setState] = useState<"loading" | "notConfigured" | "noFolder" | "ready">("loading");
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [root, setRoot] = useState<(Crumb & { drive: string }) | null>(null);
  const [cache, setCache] = useState<Record<string, SpItem[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const drive = root?.drive ?? "";
  const currentId = trail[trail.length - 1]?.id ?? root?.id ?? "";
  const items = cache[currentId] ?? [];
  const folders = useMemo(() => items.filter((i) => i.isFolder).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const files = useMemo(() => items.filter((i) => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const selectedFiles = files.filter((f) => selected.includes(f.id));

  const list = useCallback(
    async (folderId: string, force = false) => {
      if (!root) return [] as SpItem[];
      if (!force && cache[folderId]) return cache[folderId];
      const data = await callSharePoint<{ items: SpItem[] }>("list", { driveId: root.drive, itemId: folderId });
      setCache((prev) => ({ ...prev, [folderId]: data.items }));
      return data.items;
    },
    [root, cache],
  );

  // Find the project's folder: the root nobody can leave.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSharePointSettings();
      if (cancelled) return;
      setSettings(s);
      if (!s.tenant_id || !s.client_id || !s.site_url) return setState("notConfigured");
      const rows = (await loadProjectFolders(project.id)) as SharePointFolder[];
      const first = [...rows].filter((r) => r.sp_item_id).sort((a, b) => a.id - b.id)[0];
      if (!first) return setState("noFolder");
      setRoot({ id: first.sp_item_id, name: first.name, drive: first.sp_drive_id || s.drive_id });
      setTrail([]);
      setExpanded(new Set([first.sp_item_id]));
      setState("ready");
    })().catch(() => setState("noFolder"));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Load the folder being looked at.
  useEffect(() => {
    if (state !== "ready" || !root) return;
    let cancelled = false;
    setListing(true);
    setError(null);
    setSelected([]);
    list(currentId)
      .catch((err) => !cancelled && setError(tr(err, "sp.error.failed")))
      .finally(() => !cancelled && setListing(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, root?.id, currentId]);

  // A link from elsewhere (for example SST) can ask for one of the root's folders.
  const openParam = params.get("open");
  useEffect(() => {
    if (state !== "ready" || !root || !openParam) return;
    (async () => {
      const top = await list(root.id);
      const target = top.find((i) => i.isFolder && i.id === openParam);
      if (target) setTrail([{ id: target.id, name: target.name }]);
      setParams({}, { replace: true });
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, root?.id, openParam]);

  async function toggle(id: string, trailTo: Crumb[]) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      await list(id).catch(() => undefined);
    }
    setExpanded(next);
    void trailTo;
  }

  function goTo(path: Crumb[]) {
    setTrail(path);
  }

  async function reload() {
    setListing(true);
    try {
      await list(currentId, true);
    } catch (err) {
      setError(tr(err, "sp.error.failed"));
    } finally {
      setListing(false);
    }
  }

  async function uploadFiles(fileList: FileList | File[]) {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_BYTES) {
          setError(t("sp.error.tooBig"));
          continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        bytes.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        await callSharePoint("upload", { driveId: drive, parentId: currentId, name: file.name, content: btoa(binary) });
      }
      await list(currentId, true);
    } catch (err) {
      setError(tr(err, "sp.error.upload"));
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await callSharePoint("mkdir", { driveId: drive, parentId: currentId, name });
      setNewName("");
      setFolderDialog(false);
      await list(currentId, true);
    } catch (err) {
      setError(tr(err, "sp.error.createFolder"));
    } finally {
      setBusy(false);
    }
  }

  async function fetchFile(item: SpItem) {
    const s = settings ?? (await getSharePointSettings());
    const query = new URLSearchParams({
      action: "download",
      driveId: drive,
      itemId: item.id,
      name: item.name,
      tenant_id: s.tenant_id,
      client_id: s.client_id,
      site_url: s.site_url,
      drive_id: drive,
    });
    const res = await fetch(`/api/sharepoint?${query.toString()}`, { credentials: "include" });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "sp.error.download");
    }
    return res.blob();
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      for (const file of selectedFiles) downloadBlob(await fetchFile(file), file.name);
    } catch (err) {
      setError(tr(err, "sp.error.download"));
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    setBusy(true);
    setError(null);
    try {
      for (const file of selectedFiles) {
        const printable = file.mime === "application/pdf" || file.mime.startsWith("image/") || /\.(pdf|png|jpe?g|gif|webp)$/i.test(file.name);
        if (!printable) {
          setError(t("pdoc.printOnly"));
          continue;
        }
        const blob = await fetchFile(file);
        const url = URL.createObjectURL(new Blob([blob], { type: file.mime || blob.type }));
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
        frame.src = url;
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          window.setTimeout(() => {
            frame.remove();
            URL.revokeObjectURL(url);
          }, 60_000);
        };
        document.body.appendChild(frame);
      }
    } catch (err) {
      setError(tr(err, "sp.error.download"));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Card className="p-10 text-center text-sm text-muted-foreground">…</Card>;
  if (state === "notConfigured") {
    return <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />;
  }
  if (state === "noFolder" || !root) {
    return <EmptyState icon={<FolderOpen className="size-5" />} title={t("pdoc.noFolder")} description={t("pdoc.noFolderHint")} />;
  }

  const crumbs: Crumb[] = [{ id: root.id, name: root.name }, ...trail];

  function TreeNode({ node, path, depth }: { node: Crumb; path: Crumb[]; depth: number }) {
    const open = expanded.has(node.id);
    const kids = (cache[node.id] ?? []).filter((i) => i.isFolder).sort((a, b) => a.name.localeCompare(b.name));
    const active = node.id === currentId;
    return (
      <div>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors",
            active ? "font-semibold" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
          style={{
            paddingLeft: 6 + depth * 14,
            ...(active ? { background: `color-mix(in srgb, ${color} 16%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : {}),
          }}
        >
          <button type="button" aria-label={open ? "−" : "+"} className="flex size-5 items-center justify-center rounded hover:bg-foreground/10" onClick={() => void toggle(node.id, path)}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => goTo(path)}>
            {open || active ? <FolderOpen className="size-4 shrink-0" style={{ color }} /> : <Folder className="size-4 shrink-0" style={{ color }} />}
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        {open ? kids.map((k) => <TreeNode key={k.id} node={{ id: k.id, name: k.name }} path={[...path, { id: k.id, name: k.name }]} depth={depth + 1} />) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* tools */}
      <Card className="flex-row flex-wrap items-center gap-2 p-3">
        <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Upload className="size-4" />
          {t("pdoc.upload")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" onClick={() => void download()} disabled={busy || selectedFiles.length === 0}>
          <Download className="size-4" />
          {t("pdoc.download")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void print()} disabled={busy || selectedFiles.length === 0}>
          <Printer className="size-4" />
          {t("pdoc.print")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setFolderDialog(true)} disabled={busy}>
          <FolderPlus className="size-4" />
          {t("pdoc.newFolder")}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => void reload()} aria-label={t("pdoc.refresh")} title={t("pdoc.refresh")}>
          <RefreshCw className={cn("size-4", listing && "animate-spin")} />
        </Button>

        <nav className="ml-auto flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.id}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" /> : null}
              <button
                type="button"
                className={cn("max-w-[12rem] truncate rounded px-1.5 py-0.5 hover:bg-foreground/5", i === crumbs.length - 1 ? "font-semibold" : "text-muted-foreground")}
                onClick={() => goTo(trail.slice(0, i))}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      </Card>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        {/* tree: the root is the top, there is nothing above it */}
        <Card className="gap-1 p-2 lg:max-h-[68vh] lg:overflow-y-auto">
          <TreeNode node={{ id: root.id, name: root.name }} path={[]} depth={0} />
        </Card>

        {/* explorer */}
        <Card
          className={cn("gap-0 overflow-hidden p-0 transition-shadow", dragging && "ring-2")}
          style={dragging ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_120px_90px] gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground max-sm:grid-cols-[minmax(0,1fr)_70px]">
            <span>{t("pdoc.name")}</span>
            <span className="max-sm:hidden">{t("pdoc.modified")}</span>
            <span className="text-right">{t("pdoc.size")}</span>
          </div>
          {listing && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : folders.length + files.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("pdoc.empty")}</p>
          ) : (
            <ul className="max-h-[62vh] divide-y divide-border/60 overflow-y-auto">
              {[...folders, ...files].map((item) => {
                const Icon = iconFor(item);
                const on = selected.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_120px_90px] items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors max-sm:grid-cols-[minmax(0,1fr)_70px]",
                        on ? "" : "hover:bg-foreground/5",
                      )}
                      style={on ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                      onClick={() => {
                        if (item.isFolder) return;
                        setSelected((prev) => (prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]));
                      }}
                      onDoubleClick={() => {
                        if (item.isFolder) {
                          setExpanded((prev) => new Set(prev).add(currentId));
                          goTo([...trail, { id: item.id, name: item.name }]);
                        } else if (item.webUrl) window.open(item.webUrl, "_blank", "noopener");
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Icon className="size-5 shrink-0" style={item.isFolder ? { color } : undefined} />
                        <span className="truncate font-medium">{item.name}</span>
                        {item.isFolder ? (
                          <span
                            role="presentation"
                            className="ml-auto shrink-0 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-foreground/10 max-sm:hidden"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded((prev) => new Set(prev).add(currentId));
                              goTo([...trail, { id: item.id, name: item.name }]);
                            }}
                          >
                            {t("sp.openFolder")}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground max-sm:hidden">{item.lastModified ? formatDate(item.lastModified, locale) : ""}</span>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">{item.isFolder ? "" : kb(item.size)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={folderDialog} onOpenChange={setFolderDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("pdoc.newFolder")}</DialogTitle>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("pdoc.folderName")} autoFocus onKeyDown={(e) => e.key === "Enter" && void createFolder()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialog(false)}>
              {t("clients.cancel")}
            </Button>
            <Button onClick={() => void createFolder()} disabled={busy || !newName.trim()}>
              {t("pdoc.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
