import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  FileImage,
  FileOutput,
  FilePlus2,
  ChevronsUpDown,
  Trash2,
  Plus,
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
import { callSharePoint, type SpItem } from "@/lib/sharepoint";
import { downloadBlob } from "@/lib/download";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { FULL_CAPS, type DocCaps } from "@/lib/doc-rights";
import type { SharePointSettings } from "@/lib/types";
import { useSpTree, type Crumb, type SpRoot } from "@/components/project/useSpTree";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
 * The file view: a tree of folders on the left, the tools on top (upload, download, export to PDF, print, selection)
 * and the folder's files in the middle like a file explorer. Nothing above `root` can be reached.
 */
/**
 * `caps`: what the person may do in a folder, given the folder and its ancestors (nearest first, the root last). Without it
 * they may do everything (administrators). Folders they have no right on are not shown.
 */
export function DocsExplorer({ root, settings, color, rootLabel, caps }: { root: SpRoot; settings: SharePointSettings; color: string; rootLabel: string; caps?: (chain: string[]) => DocCaps }) {
  const { t, locale, tr } = useI18n();
  const [params, setParams] = useSearchParams();
  const tree = useSpTree(root);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the "new" dialog is creating: a folder or a blank document. */
  const [newKind, setNewKind] = useState<"folder" | "docx" | "xlsx" | "txt" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  const drive = root.drive;
  const currentId = trail[trail.length - 1]?.id ?? root.id;
  /** The folder and its ancestors, nearest first. */
  const chainHere = [...trail.map((c) => c.id).reverse(), root.id].filter((id, i, all) => all.indexOf(id) === i);
  const rights = (chain: string[]) => (caps ? caps(chain) : FULL_CAPS);
  const here = rights(chainHere);
  const items = tree.cache[currentId] ?? [];
  const folders = useMemo(
    () => items.filter((i) => i.isFolder && rights([i.id, ...chainHere]).view).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, caps, currentId, trail],
  );
  const files = useMemo(() => items.filter((i) => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const ordered = useMemo(() => [...folders, ...files], [folders, files]);
  const selectedFiles = files.filter((f) => selected.includes(f.id));
  const selectedItems = ordered.filter((i) => selected.includes(i.id));

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

  async function createNew() {
    const base = newName.trim();
    if (!base || !newKind) return;
    setBusy(true);
    setError(null);
    try {
      if (newKind === "folder") {
        await callSharePoint("mkdir", { driveId: drive, parentId: currentId, name: base });
      } else {
        const name = /\.\w{2,4}$/.test(base) ? base : `${base}.${newKind}`;
        await callSharePoint("upload", { driveId: drive, parentId: currentId, name, content: "", blank: true });
      }
      setNewName("");
      setNewKind(null);
      await tree.list(currentId, true);
    } catch (err) {
      setError(tr(err, newKind === "folder" ? "sp.error.createFolder" : "sp.error.upload"));
    } finally {
      setBusy(false);
    }
  }

  /** Deletes everything ticked: files and folders (a folder goes with its content). */
  async function deleteSelected() {
    setBusy(true);
    setError(null);
    try {
      for (const item of selectedItems) await callSharePoint("delete", { driveId: drive, itemId: item.id });
      setDeleteOpen(false);
      setSelected([]);
      await tree.list(currentId, true);
    } catch (err) {
      setError(tr(err, "sp.error.delete"));
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

  /** Shows a file in a page without handing it over: what the view-only level allows. */
  async function showFile(item: SpItem) {
    setBusy(true);
    setError(null);
    try {
      const out = await callSharePoint<{ url: string }>("preview", { driveId: drive, itemId: item.id });
      if (!out.url) throw new Error("pdoc.noPreview");
      setPreview({ name: item.name, url: out.url });
    } catch (err) {
      setError(tr(err, "pdoc.noPreview"));
    } finally {
      setBusy(false);
    }
  }
  const openPreview = () => (selectedFiles[0] ? showFile(selectedFiles[0]) : Promise.resolve());

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
    const kids = tree.subfolders(node.id).filter((k) => rights([k.id, ...path.map((c) => c.id).reverse(), root.id]).view);
    const active = node.id === currentId;
    return (
      <div key={node.id || "root"}>
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

  const crumbs: Crumb[] = [{ id: root.id, name: rootLabel }, ...trail];
  const all = ordered.length > 0 && selectedItems.length === ordered.length;
  const needsSelection = busy || selectedFiles.length === 0;
  const openNew = (kind: "folder" | "docx" | "xlsx" | "txt") => {
    setNewName(kind === "folder" ? "" : t(`pdoc.new.${kind}Name` as never));
    setNewKind(kind);
  };

  return (
    <div className="space-y-3">
      <Card className="flex-row flex-wrap items-center gap-2 p-3">
        {here.upload ? (
          <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload className="size-4" />
            {t("pdoc.upload")}
          </Button>
        ) : null}
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
        {here.upload ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy}>
              <Plus className="size-4" />
              {t("pdoc.new")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            <DropdownMenuItem onSelect={() => openNew("folder")}>
              <FolderPlus className="size-4" />
              {t("pdoc.newFolder")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openNew("docx")}>
              <FileText className="size-4" />
              {t("pdoc.new.docx")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openNew("xlsx")}>
              <FileSpreadsheet className="size-4" />
              {t("pdoc.new.xlsx")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openNew("txt")}>
              <FilePlus2 className="size-4" />
              {t("pdoc.new.txt")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void openPreview()} disabled={busy || selectedFiles.length !== 1}>
          <Eye className="size-4" />
          {t("pdoc.view")}
        </Button>
        {here.download ? (
          <>
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
          </>
        ) : null}
        {here.modify ? (
          <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} disabled={busy || selectedItems.length === 0} className="text-destructive hover:text-destructive">
            <Trash2 className="size-4" />
            {t("pdoc.delete")}
          </Button>
        ) : null}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button size="sm" variant="ghost" onClick={() => setSelected(all ? [] : ordered.map((i) => i.id))} disabled={ordered.length === 0}>
          <ChevronsUpDown className="size-4" />
          {all ? t("pdoc.clear") : t("pdoc.selectAll")}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">{t("pdoc.selected", { n: selectedItems.length })}</span>
        <span className="hidden text-[11px] text-muted-foreground xl:inline">{t("pdoc.selectHint")}</span>
        {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </Card>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <Card className="gap-1 p-2 lg:max-h-[66vh] lg:overflow-y-auto">
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("pdoc.folders")}</span>
            <span className="flex items-center gap-0.5">
              {here.upload ? (
                <Button size="icon-sm" variant="ghost" aria-label={t("pdoc.newFolder")} title={t("pdoc.newFolder")} onClick={() => openNew("folder")} disabled={busy}>
                  <FolderPlus className="size-4" />
                </Button>
              ) : null}
              <Button size="icon-sm" variant="ghost" aria-label={t("pdoc.refresh")} title={t("pdoc.refresh")} onClick={() => void reload()}>
                <RefreshCw className={cn("size-4", listing && "animate-spin")} />
              </Button>
            </span>
          </div>
          {renderNode({ id: root.id, name: rootLabel }, [], 0)}
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
            if (here.upload && e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
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
              {ordered.map((item, idx) => {
                const Icon = iconFor(item);
                const on = selected.includes(item.id);
                const toggle = (range = false) => {
                  if (range && lastIdx !== null) {
                    const [from, to] = lastIdx < idx ? [lastIdx, idx] : [idx, lastIdx];
                    const ids = ordered.slice(from, to + 1).map((i) => i.id);
                    setSelected((prev) => [...new Set([...prev, ...ids])]);
                  } else {
                    setSelected((prev) => (prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]));
                  }
                  setLastIdx(idx);
                };
                const openFolder = () => {
                  tree.open(currentId);
                  goTo([...trail, { id: item.id, name: item.name }]);
                };
                return (
                  <li
                    key={item.id}
                    className={cn("grid cursor-default grid-cols-[28px_minmax(0,1fr)_120px_90px] items-center gap-3 px-4 py-2.5 text-sm transition-colors max-sm:grid-cols-[28px_minmax(0,1fr)_70px]", !on && "hover:bg-foreground/5")}
                    style={on ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                    onClick={(e) => toggle(e.shiftKey)}
                    onDoubleClick={() => (item.isFolder ? openFolder() : here.download && item.webUrl ? window.open(item.webUrl, "_blank", "noopener") : void showFile(item))}
                  >
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={on} onCheckedChange={() => toggle()} aria-label={item.name} />
                    </span>
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

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="h-[85vh] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview ? <iframe title={preview.name} src={preview.url} className="size-full rounded-lg border bg-white" /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={newKind !== null} onOpenChange={(o) => !o && setNewKind(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{newKind === "folder" ? t("pdoc.newFolder") : newKind ? t(`pdoc.new.${newKind}` as never) : ""}</DialogTitle>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={newKind === "folder" ? t("pdoc.folderName") : t("pdoc.fileName")} autoFocus onKeyDown={(e) => e.key === "Enter" && void createNew()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewKind(null)}>
              {t("clients.cancel")}
            </Button>
            <Button onClick={() => void createNew()} disabled={busy || !newName.trim()}>
              {t("pdoc.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pdoc.deleteTitle", { n: selectedItems.length })}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-sm">
            {selectedItems.map((i) => (
              <li key={i.id} className="flex items-center gap-2 truncate">
                {i.isFolder ? <Folder className="size-4 shrink-0" style={{ color }} /> : <FileIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{i.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t("pdoc.deleteWarn")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("clients.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void deleteSelected()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t("pdoc.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
