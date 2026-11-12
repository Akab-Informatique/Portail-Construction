import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, FileText, GripVertical, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { downloadBlob } from "@/lib/download";
import {
  addAttachment,
  attachmentBlob,
  listAttachments,
  removeAttachment,
  saveAttachmentOrder,
  type Attachment,
  type AttachmentOwner,
} from "@/lib/project-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (a: Attachment) => (a.file_type ?? "").startsWith("image/");
type Kind = "photo" | "file";
const kindOf = (a: Attachment): Kind => (isImage(a) ? "photo" : "file");

/**
 * Moves one file to position `to` among the files of its own kind: photos stay among photos, other files among files.
 * The order of the other kind is kept in place.
 */
function reorderWithin(all: Attachment[], id: number, to: number): Attachment[] {
  const item = all.find((f) => f.id === id);
  if (!item) return all;
  const kind = kindOf(item);
  const slots = all.flatMap((f, i) => (kindOf(f) === kind ? [i] : []));
  const without = slots.map((i) => all[i]).filter((f) => f.id !== id);
  without.splice(Math.max(0, Math.min(to, without.length)), 0, item);
  const out = [...all];
  slots.forEach((pos, k) => {
    out[pos] = without[k];
  });
  return out;
}

export function Thumb({ file, onOpen }: { file: Attachment; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void attachmentBlob(file.id).then((blob) => {
      if (!blob || cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id]);
  return (
    <button type="button" onClick={onOpen} className="group relative size-20 overflow-hidden rounded-lg border bg-muted shadow-sm transition-transform hover:-translate-y-0.5" title={file.file_name}>
      {src ? <img src={src} alt={file.file_name} className="size-full object-cover" /> : <Loader2 className="m-auto size-4 animate-spin text-muted-foreground" />}
    </button>
  );
}

/**
 * Files and photos on a task, note, SST incident or QRT entry. Photos show as thumbnails you can open large;
 * other files show as rows you can download. Phones get a camera button.
 * Whoever may edit can change the order: drag an item, or use the arrow buttons (keyboard). The order is saved.
 */
export function Attachments({
  projectId,
  owner,
  ownerId,
  canEdit = true,
  onChange,
  compact = false,
}: {
  projectId: number;
  owner: AttachmentOwner;
  ownerId: number;
  canEdit?: boolean;
  onChange?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState<{ id: number; kind: Kind } | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setFiles(await listAttachments(projectId, owner, ownerId));
  }, [projectId, owner, ownerId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    setBusy(true);
    setError(null);
    try {
      for (const file of picked) {
        try {
          await addAttachment(file, { projectId, owner, ownerId, userId: user?.id ?? null });
        } catch (err) {
          console.error("attachment upload failed", err);
          setError(err instanceof Error && err.message === "tooBig" ? t("att.tooBig") : `${t("att.failed")} (${err instanceof Error ? err.message.slice(0, 80) : "?"})`);
        }
      }
      await load();
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  async function open(file: Attachment) {
    const blob = await attachmentBlob(file.id);
    if (!blob) return;
    if (isImage(file)) setPreview({ url: URL.createObjectURL(blob), name: file.file_name });
    else downloadBlob(blob, file.file_name);
  }

  /** Saves a new order (the list as shown, first to last). The screen follows at once; a failure brings back the saved order. */
  async function commitOrder(next: Attachment[]) {
    if (next.every((f, i) => f.id === files[i]?.id)) return;
    setFiles(next);
    setError(null);
    try {
      await saveAttachmentOrder(next.map((f) => f.id));
      onChange?.();
    } catch (err) {
      console.error("attachment order failed", err);
      setError(t("att.orderFailed"));
      await load();
    }
  }

  function moveBy(id: number, delta: number) {
    const item = files.find((f) => f.id === id);
    if (!item) return;
    const sameKind = files.filter((f) => kindOf(f) === kindOf(item));
    const at = sameKind.findIndex((f) => f.id === id);
    const to = at + delta;
    if (to < 0 || to >= sameKind.length) return;
    void commitOrder(reorderWithin(files, id, to));
  }

  function dropOn(targetId: number) {
    if (!drag || drag.id === targetId) return;
    const sameKind = files.filter((f) => kindOf(f) === drag.kind);
    const to = sameKind.findIndex((f) => f.id === targetId);
    if (to >= 0) void commitOrder(reorderWithin(files, drag.id, to));
  }

  /** Drag handlers for one item; an item can only be dropped among items of its own kind. */
  function dragProps(file: Attachment) {
    if (!canEdit) return {};
    const kind = kindOf(file);
    return {
      draggable: true,
      title: t("att.dragHint"),
      onDragStart: (e: DragEvent<HTMLElement>) => {
        setDrag({ id: file.id, kind });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(file.id));
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!drag || drag.kind !== kind) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverId(file.id);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        dropOn(file.id);
        setDrag(null);
        setOverId(null);
      },
      onDragEnd: () => {
        setDrag(null);
        setOverId(null);
      },
    };
  }

  const photos = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  const dropping = (f: Attachment) => overId === f.id && drag?.kind === kindOf(f) && drag.id !== f.id;

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => pick.current?.click()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            {t("att.add")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => camera.current?.click()}>
            <Camera className="size-4" />
            {t("att.photo")}
          </Button>
          <input ref={pick} type="file" multiple className="sr-only" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className={`relative flex flex-col items-center gap-1 rounded-lg transition-shadow ${dropping(p) ? "ring-2 ring-primary" : ""}`} {...dragProps(p)}>
              <Thumb file={p} onOpen={() => void open(p)} />
              {canEdit && photos.length > 1 ? (
                <div className="flex items-center gap-0.5">
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("att.moveEarlier")} title={t("att.moveEarlier")} disabled={photos[0].id === p.id} onClick={() => moveBy(p.id, -1)}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <GripVertical className="size-3.5 text-muted-foreground" aria-hidden />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("att.moveLater")} title={t("att.moveLater")} disabled={photos[photos.length - 1].id === p.id} onClick={() => moveBy(p.id, 1)}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              ) : null}
              {canEdit && !compact ? (
                <button
                  type="button"
                  aria-label={t("exp.delete")}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
                  onClick={async () => {
                    await removeAttachment(p.id);
                    await load();
                    onChange?.();
                  }}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {others.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {others.map((f) => (
            <li key={f.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${dropping(f) ? "bg-primary/10" : ""}`} {...dragProps(f)}>
              {canEdit ? <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden /> : null}
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
              <span className="text-xs text-muted-foreground">{kb(f.file_size)}</span>
              {canEdit && others.length > 1 ? (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label={t("att.moveEarlier")} title={t("att.moveEarlier")} disabled={others[0].id === f.id} onClick={() => moveBy(f.id, -1)}>
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t("att.moveLater")} title={t("att.moveLater")} disabled={others[others.length - 1].id === f.id} onClick={() => moveBy(f.id, 1)}>
                    <ChevronDown className="size-4" />
                  </Button>
                </>
              ) : null}
              <Button size="icon-sm" variant="ghost" aria-label={t("pdoc.download")} onClick={() => void open(f)}>
                <Download className="size-4" />
              </Button>
              {canEdit ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("exp.delete")}
                  onClick={async () => {
                    await removeAttachment(f.id);
                    await load();
                    onChange?.();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview ? <img src={preview.url} alt={preview.name} className="max-h-[75vh] w-full rounded-lg object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
