import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Download, FileText, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { downloadBlob } from "@/lib/download";
import {
  addAttachment,
  attachmentBlob,
  listAttachments,
  removeAttachment,
  type Attachment,
  type AttachmentOwner,
} from "@/lib/project-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (a: Attachment) => (a.file_type ?? "").startsWith("image/");

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
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        try {
          await addAttachment(file, { projectId, owner, ownerId, userId: user?.id ?? null });
        } catch (err) {
          setError(err instanceof Error && err.message === "tooBig" ? t("att.tooBig") : t("att.failed"));
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

  const photos = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));

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
            <div key={p.id} className="relative">
              <Thumb file={p} onOpen={() => void open(p)} />
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
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
              <span className="text-xs text-muted-foreground">{kb(f.file_size)}</span>
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
