import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Loader2,
  Printer,
  RefreshCw,
  Upload,
} from "lucide-react";
import { callSharePoint, loadProjectFolders, type SpItem } from "@/lib/sharepoint";
import { getSharePointSettings } from "@/lib/settings";
import { downloadBlob } from "@/lib/download";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { projectColor } from "@/lib/project-colors";
import type { SharePointFolder, SharePointSettings } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { ProjectDocsAccess } from "@/components/project/ProjectDocsAccess";
import { useSpTree, type Crumb, type SpRoot } from "@/components/project/useSpTree";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

const MAX_BYTES = 4 * 1024 * 1024;

function iconFor(item: SpItem) {
  if (item.isFolder) return Folder;
  const m = item.mime || "";
  const n = item.name.toLowerCase();
  if (m.startsWith("image/")) return FileImage;
  if (m.includes("sheet") || /\.(xlsx?|csv)$/.test(n)) return FileSpreadsheet;
  if (m.includes("pdf") || /\.(pdf|docx?|txt)$/.test(n)) return FileText;
  return FileIcon;
}
const isPdf = (f: SpItem) => f.mime === "application/pdf" || /\.pdf$/i.test(f.name);
const isImage = (f: SpItem) => f.mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Documentation. Two tabs: the files (a tree on the left, a file explorer in the middle) and, for administrators,
 * who can see what. The project's SharePoint folder is the root and nothing above it can be reached.
 */
export function ProjectDocuments({ project }: SectionProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const color = projectColor(project);
  const isAdmin = Boolean(user?.is_admin) && user?.view_as !== "client";
  const tab = isAdmin && params.get("tab") === "access" ? "access" : "files";
  const [state, setState] = useState<"loading" | "notConfigured" | "noFolder" | "ready">("loading");
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [root, setRoot] = useState<SpRoot | null>(null);

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
      setRoot({ id: first.sp_item_id, name: first.name, drive: first.sp_drive_id || s.drive_id, rowId: first.id });
      setState("ready");
    })().catch(() => setState("noFolder"));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  if (state === "loading") return <Card className="p-10 text-center text-sm text-muted-foreground">…</Card>;
  if (state === "notConfigured") return <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />;
  if (state === "noFolder" || !root) return <EmptyState icon={<FolderOpen className="size-5" />} title={t("pdoc.noFolder")} description={t("pdoc.noFolderHint")} />;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="flex w-fit items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {(
            [
              ["files", t("pdoc.tabFiles"), FolderOpen],
              ["access", t("pdoc.tabAccess"), KeyRound],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setParams(id === "access" ? { tab: "access" } : {}, { replace: true })}
              className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", tab === id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              style={tab === id ? { background: `color-mix(in srgb, ${color} 18%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
            >
              <Icon className="size-4" style={tab === id ? { color } : undefined} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "access" ? <ProjectDocsAccess project={project} root={root} /> : <Explorer project={project} root={root} settings={settings!} />}
    </div>
  );
}

function Explorer({ project, root, settings }: { project: SectionProps["project"]; root: SpRoot; settings: SharePointSettings }) {
  const { t, locale, tr } = useI18n();
  const [params, setParams] = useSearchParams();
  const color = projectColor(project);
  const tree = useSpTree(root);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const drive = root.drive;
  const currentId = trail[trail.length - 1]?.id ?? root.id;
  const items = tree.cache[currentId] ?? [];
  const folders = useMemo(() => items.filter((i) => i.isFolder).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const files = useMemo(() => items.filter((i) => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const selectedFiles = files.filter((f) => selected.includes(f.id));

  // Load the folder being looked at (and the root, so the tree can open).
  useEffect(() => {
    let cancelled = false;
    setListing(true);
    setError(null);
    setSelected([]);
    Promise.all([tree.list(currentId), currentId === root.id ? Promise.resolve([]) : tree.list(root.id)])
      .catch((err) => !cancelled && setError(tr(err, "sp.error.failed")))
      .finally(() => !cancelled && setListing(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // A link from elsewhere (SST) can ask for one of the root's folders.
  const openParam = params.get("open");
  useEffect(() => {
    if (!openParam) return;
    (async () => {
      const top = await tree.list(root.id);
      const target = top.find((i) => i.isFolder && i.id === openParam);
      if (target) setTrail([{ id: target.id, name: target.name }]);
      setParams({}, { replace: true });
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam]);

  const goTo = (path: Crumb[]) => setTrail(path);

  async function reload() {
    setListing(true);
    try {
      await tree.list(currentId, true);
    } catch (err) {
      setError(tr(err, "sp.error.failed"));
    } finally {
      setListing(false);
    }
  }

  async function uploadFiles(fileList: FileList | File[]) {
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
      await tree.list(currentId, true);
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
      await tree.list(currentId, true);
    } catch (err) {
      setError(tr(err, "sp.error.createFolder"));
    } finally {
      setBusy(false);
    }
  }

  async function fetchFile(item: SpItem, asPdf = false) {
    const query = new URLSearchParams({
      action: "download",
      driveId: drive,
      itemId: item.id,
      name: item.name,
      tenant_id: settings.tenant_id,
      client_id: settings.client_id,
      site_url: settings.site_url,
      drive_id: drive,
    });
    if (asPdf) query.set("format", "pdf");
    const res = await fetch(`/api/sharepoint?${query.toString()}`, { credentials: "include" });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "sp.error.download");
    }
    return res.blob();
  }

  /** A PDF of any file: PDFs as they are, pictures drawn onto a page, Office documents converted by SharePoint. */
  async function pdfOf(item: SpItem): Promise<Blob> {
    if (isPdf(item)) return fetchFile(item);
    if (isImage(item)) {
      const blob = await fetchFile(item);
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = url;
        });
        const { jsPDF } = await import("jspdf");
        const landscape = img.width > img.height;
        const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
        const w = doc.internal.pageSize.getWidth();
        const h = doc.internal.pageSize.getHeight();
        const scale = Math.min((w - 40) / img.width, (h - 40) / img.height);
        doc.addImage(img, blob.type.includes("png") ? "PNG" : "JPEG", (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
        return doc.output("blob");
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return fetchFile(item, true);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(tr(err, "sp.error.download"));
    } finally {
      setBusy(false);
    }
  }

  const download = () =>
    run(async () => {
      for (const file of selectedFiles) downloadBlob(await fetchFile(file), file.name);
    });

  const exportPdf = () =>
    run(async () => {
      for (const file of selectedFiles) downloadBlob(await pdfOf(file), file.name.replace(/\.[^.]+$/, "") + ".pdf");
    });

  const print = () =>
    run(async () => {
      for (const file of selectedFiles) {
        const blob = await pdfOf(file);
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
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
    });

  function renderNode(node: Crumb, path: Crumb[], depth: number) {
    const open = tree.expanded.has(node.id);
    const kids = tree.subfolders(node.id);
    const active = node.id === currentId;
    return (
      <div key={node.id}>
        <div
          className={cn("flex items-center gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors", active ? "font-semibold" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")}
          style={{ paddingLeft: 6 + depth * 14, ...(active ? { background: `color-mix(in srgb, ${color} 16%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : {}) }}
        >
          <button type="button" aria-label={open ? "−" : "+"} className="flex size-5 items-center justify-center rounded hover:bg-foreground/10" onClick={() => void tree.toggle(node.id)}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => goTo(path)}>
            {open || active ? <FolderOpen className="size-4 shrink-0" style={{ color }} /> : <Folder className="size-4 shrink-0" style={{ color }} />}
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        {open ? kids.map((k) => renderNode({ id: k.id, name: k.name }, [...path, { id: k.id, name: k.name }], depth + 1)) : null}
      </div>
    );
  }

  const crumbs: Crumb[] = [{ id: root.id, name: root.name }, ...trail];
  const all = files.length > 0 && selectedFiles.length === files.length;
  const needsSelection = busy || selectedFiles.length === 0;

  return (
    <div className="space-y-3">
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
        <Button size="sm" variant="outline" onClick={() => void download()} disabled={needsSelection}>
          <Download className="size-4" />
          {t("pdoc.download")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void exportPdf()} disabled={needsSelection}>
          <FileOutput className="size-4" />
          {t("pdoc.exportPdf")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void print()} disabled={needsSelection}>
          <Printer className="size-4" />
          {t("pdoc.print")}
        </Button>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button size="sm" variant="ghost" onClick={() => setSelected(all ? [] : files.map((f) => f.id))} disabled={files.length === 0}>
          {all ? t("pdoc.clear") : t("pdoc.selectAll")}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">{t("pdoc.selected", { n: selectedFiles.length })}</span>
        {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </Card>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <Card className="gap-1 p-2 lg:max-h-[66vh] lg:overflow-y-auto">
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("pdoc.folders")}</span>
            <span className="flex items-center gap-0.5">
              <Button size="icon-sm" variant="ghost" aria-label={t("pdoc.newFolder")} title={t("pdoc.newFolder")} onClick={() => setFolderDialog(true)} disabled={busy}>
                <FolderPlus className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={t("pdoc.refresh")} title={t("pdoc.refresh")} onClick={() => void reload()}>
                <RefreshCw className={cn("size-4", listing && "animate-spin")} />
              </Button>
            </span>
          </div>
          {renderNode({ id: root.id, name: root.name }, [], 0)}
        </Card>

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
          <nav className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-2 text-sm">
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
          <div className="grid grid-cols-[28px_minmax(0,1fr)_120px_90px] gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground max-sm:grid-cols-[28px_minmax(0,1fr)_70px]">
            <span />
            <span>{t("pdoc.name")}</span>
            <span className="max-sm:hidden">{t("pdoc.modified")}</span>
            <span className="text-right">{t("pdoc.size")}</span>
          </div>
          {listing && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : folders.length + files.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("pdoc.empty")}</p>
          ) : (
            <ul className="max-h-[58vh] divide-y divide-border/60 overflow-y-auto">
              {[...folders, ...files].map((item) => {
                const Icon = iconFor(item);
                const on = selected.includes(item.id);
                const toggle = () => setSelected((prev) => (prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]));
                const openFolder = () => {
                  tree.open(currentId);
                  goTo([...trail, { id: item.id, name: item.name }]);
                };
                return (
                  <li
                    key={item.id}
                    className={cn("grid cursor-default grid-cols-[28px_minmax(0,1fr)_120px_90px] items-center gap-3 px-4 py-2.5 text-sm transition-colors max-sm:grid-cols-[28px_minmax(0,1fr)_70px]", !on && "hover:bg-foreground/5")}
                    style={on ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                    onClick={() => (item.isFolder ? undefined : toggle())}
                    onDoubleClick={() => (item.isFolder ? openFolder() : item.webUrl ? window.open(item.webUrl, "_blank", "noopener") : undefined)}
                  >
                    <span onClick={(e) => e.stopPropagation()}>{item.isFolder ? null : <Checkbox checked={on} onCheckedChange={toggle} aria-label={item.name} />}</span>
                    <span className="flex min-w-0 items-center gap-3">
                      <Icon className="size-5 shrink-0" style={item.isFolder ? { color } : undefined} />
                      {item.isFolder ? (
                        <button
                          type="button"
                          className="truncate text-left font-medium hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFolder();
                          }}
                        >
                          {item.name}
                        </button>
                      ) : (
                        <span className="truncate font-medium">{item.name}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground max-sm:hidden">{item.lastModified ? formatDate(item.lastModified, locale) : ""}</span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">{item.isFolder ? "" : kb(item.size)}</span>
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
