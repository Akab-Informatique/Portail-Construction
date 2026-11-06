import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, ChevronDown, ChevronUp, FileDown, FileText, ImagePlus, Loader2, MonitorUp, Plus, Save, Square, Trash2, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { exportSopHtml, exportSopPdf, frameToJpeg, imageToJpeg, loadSop, loadVideo, newStep, parseSteps, removeVideo, saveSop, saveVideo, startCapture, type Capture, type SopStep } from "@/lib/sop";

type Pip = { win: Window; count: (n: number) => void };

/** Small always-on-top window (Chrome) with the capture buttons, so the screen being shown stays in front. */
async function openPip(labels: { capture: (n: number) => string; stop: string }, onCapture: () => void, onStop: () => void): Promise<Pip | null> {
  const api = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
  if (!api) return null;
  const win = await api.requestWindow({ width: 300, height: 110 });
  const doc = win.document;
  doc.body.style.cssText = "margin:0;padding:12px;font-family:system-ui,Segoe UI,sans-serif;background:#141414;display:flex;gap:8px;align-items:stretch;height:100vh;box-sizing:border-box";
  const style = "border:0;border-radius:10px;font:600 14px system-ui,Segoe UI,sans-serif;cursor:pointer;padding:0 14px;";
  const cap = doc.createElement("button");
  cap.style.cssText = `${style}background:#fbaa19;color:#000;flex:1`;
  cap.textContent = labels.capture(0);
  const stop = doc.createElement("button");
  stop.style.cssText = `${style}background:#3a3a3a;color:#fff`;
  stop.textContent = labels.stop;
  cap.onclick = () => {
    onCapture();
    cap.style.background = "#7dd87d";
    setTimeout(() => (cap.style.background = "#fbaa19"), 250);
  };
  stop.onclick = onStop;
  doc.body.append(cap, stop);
  return { win, count: (n) => (cap.textContent = labels.capture(n)) };
}

/**
 * Makes one procedure: share a screen or window and capture each step (optionally recording it as video too), then edit the
 * steps — title, instructions, picture, order — and save it to the binder. A picture can also be pasted or added from a file.
 */
export function SopEditorPage() {
  const { id } = useParams();
  const sopId = id && id !== "new" ? Number(id) : null;
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(sopId !== null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [steps, setSteps] = useState<SopStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [recordToo, setRecordToo] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capCount, setCapCount] = useState(0);
  const [hasPip, setHasPip] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [pendingVideo, setPendingVideo] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const capRef = useRef<Capture | null>(null);
  const pipRef = useRef<Pip | null>(null);
  const countRef = useRef(0);
  const videoEl = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceFor = useRef<string | null>(null);

  const touch = () => setDirty(true);

  useEffect(() => {
    if (sopId === null) return;
    let live = true;
    setLoading(true);
    void loadSop(sopId).then((row) => {
      if (!live) return;
      if (!row) {
        navigate("/sops", { replace: true });
        return;
      }
      setTitle(row.title);
      setDescription(row.description ?? "");
      setCategory(row.category ?? "");
      setSteps(parseSteps(row.steps));
      setHasVideo(row.has_video === 1);
      setUpdatedAt(row.updated_at);
      setDirty(false);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [sopId, navigate]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const addImageStep = useCallback(async (file: Blob) => {
    const image = await imageToJpeg(file);
    setSteps((s) => [...s, newStep(image)]);
    setDirty(true);
  }, []);

  // A screenshot pasted anywhere on the page becomes a step.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void addImageStep(file);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addImageStep]);

  // Leaving the page ends the sharing.
  useEffect(
    () => () => {
      void capRef.current?.stop();
      pipRef.current?.win.close();
    },
    [],
  );

  const captureStep = useCallback(() => {
    const cap = capRef.current;
    if (!cap) return;
    const image = cap.grab();
    countRef.current += 1;
    setCapCount(countRef.current);
    pipRef.current?.count(countRef.current);
    setSteps((s) => [...s, newStep(image)]);
    setDirty(true);
  }, []);

  const stopCapture = useCallback(async () => {
    const cap = capRef.current;
    capRef.current = null;
    pipRef.current?.win.close();
    pipRef.current = null;
    setCapturing(false);
    setHasPip(false);
    if (!cap) return;
    const blob = await cap.stop();
    if (blob) {
      setPendingVideo(blob);
      setVideoUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setDirty(true);
    }
  }, []);

  const openControls = useCallback(async () => {
    try {
      const pip = await openPip({ capture: (n) => t("sop.captureBtn", { n }), stop: t("sop.stop") }, captureStep, () => void stopCapture());
      if (pip) {
        pip.win.addEventListener("pagehide", () => {
          if (pipRef.current === pip) pipRef.current = null;
          setHasPip(false);
        });
        pip.count(countRef.current);
        pipRef.current = pip;
        setHasPip(true);
      }
    } catch {
      /* the floating window needs a fresh click: the bar on the page stays available */
    }
  }, [captureStep, stopCapture, t]);

  async function startSharing() {
    setError("");
    try {
      countRef.current = 0;
      setCapCount(0);
      capRef.current = await startCapture(recordToo, () => void stopCapture());
      setCapturing(true);
      void openControls();
    } catch {
      setError(t("sop.captureDenied"));
    }
  }

  async function save() {
    if (!title.trim()) {
      setError(t("sop.titleRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const wantsVideo = hasVideo || pendingVideo !== null;
      const savedId = await saveSop({ id: sopId, title, description, category, steps, hasVideo: wantsVideo, userId: user?.id ?? null });
      if (pendingVideo) {
        await saveVideo(savedId, pendingVideo);
        setHasVideo(true);
        setPendingVideo(null);
      }
      setDirty(false);
      setUpdatedAt(new Date());
      if (sopId === null) navigate(`/sops/${savedId}`, { replace: true });
    } catch {
      setError(t("sop.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function showVideo() {
    if (!sopId) return;
    setVideoLoading(true);
    const blob = await loadVideo(sopId);
    setVideoLoading(false);
    if (blob) setVideoUrl(URL.createObjectURL(blob));
  }

  async function dropVideo() {
    if (!window.confirm(t("sop.videoDeleteConfirm"))) return;
    if (sopId && hasVideo) {
      await removeVideo(sopId);
      await saveSop({ id: sopId, title, description, category, steps, hasVideo: false, userId: user?.id ?? null });
    }
    setHasVideo(false);
    setPendingVideo(null);
    setVideoUrl(null);
  }

  function frameFromVideo() {
    const v = videoEl.current;
    if (!v || !v.videoWidth) return;
    setSteps((s) => [...s, newStep(frameToJpeg(v))]);
    touch();
  }

  const update = (stepId: string, patch: Partial<SopStep>) => {
    setSteps((s) => s.map((x) => (x.id === stepId ? { ...x, ...patch } : x)));
    touch();
  };
  const move = (i: number, dir: -1 | 1) => {
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
    touch();
  };
  const exportInput = () => ({
    title: title || t("sop.untitled"),
    description,
    category,
    steps,
    author: user?.name,
    date: formatDate((updatedAt ?? new Date()).toISOString().slice(0, 10), locale),
    stepLabel: t("sop.step"),
    heading: t("sop.heading"),
  });

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => (!dirty || window.confirm(t("sop.leaveConfirm"))) && navigate("/sops")}>
          <ArrowLeft className="size-4" />
          {t("sop.title")}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty ? <span className="text-xs text-muted-foreground">{t("sop.unsaved")}</span> : null}
          <Button variant="outline" size="sm" disabled={steps.length === 0} onClick={() => void exportSopPdf(exportInput())}>
            <FileDown className="size-4" />
            PDF
          </Button>
          <Button variant="outline" size="sm" disabled={steps.length === 0} onClick={() => exportSopHtml(exportInput())} title={t("sop.htmlHint")}>
            <FileText className="size-4" />
            {t("sop.shareFile")}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("sop.save")}
          </Button>
        </div>
      </div>

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <Card className="gap-4 p-5" style={{ boxShadow: "var(--glass-shadow), inset 0 3px 0 #faa32b" }}>
        <div className="space-y-1.5">
          <Label>{t("sop.name")}</Label>
          <Input correct value={title} placeholder={t("sop.namePh")} onChange={(e) => { setTitle(e.target.value); touch(); }} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("sop.description")}</Label>
            <Textarea correct rows={2} value={description} placeholder={t("sop.descriptionPh")} onChange={(e) => { setDescription(e.target.value); touch(); }} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("sop.category")}</Label>
            <Input value={category} placeholder={t("sop.categoryPh")} onChange={(e) => { setCategory(e.target.value); touch(); }} />
          </div>
        </div>
      </Card>

      <Card className="gap-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          {capturing ? (
            <>
              <Button onClick={captureStep}>
                <Camera className="size-4" />
                {t("sop.captureBtn", { n: capCount })}
              </Button>
              <Button variant="outline" onClick={() => void stopCapture()}>
                <Square className="size-4" />
                {t("sop.stop")}
              </Button>
              {!hasPip && "documentPictureInPicture" in window ? (
                <Button variant="ghost" size="sm" onClick={() => void openControls()}>
                  {t("sop.floating")}
                </Button>
              ) : null}
              <span className="flex items-center gap-1.5 text-sm text-rose-600">
                <span className="size-2 animate-pulse rounded-full bg-rose-500" />
                {capRef.current?.recording ? t("sop.recording") : t("sop.sharing")}
              </span>
            </>
          ) : (
            <>
              <Button onClick={() => void startSharing()}>
                <MonitorUp className="size-4" />
                {t("sop.startCapture")}
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={recordToo} onCheckedChange={setRecordToo} aria-label={t("sop.alsoRecord")} />
                <Video className="size-4 text-muted-foreground" />
                {t("sop.alsoRecord")}
              </label>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{capturing ? t("sop.capturingHint") : t("sop.startHint")}</p>
      </Card>

      {videoUrl || hasVideo ? (
        <Card className="gap-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Video className="size-4" />
              {t("sop.video")}
            </h2>
            {pendingVideo ? <span className="text-xs text-muted-foreground">{t("sop.videoPending", { mb: (pendingVideo.size / 1048576).toFixed(1) })}</span> : null}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void dropVideo()}>
              <Trash2 className="size-4" />
              {t("exp.delete")}
            </Button>
          </div>
          {videoUrl ? (
            <>
              <video ref={videoEl} src={videoUrl} controls className="max-h-96 w-full rounded-lg border bg-black" />
              <div>
                <Button size="sm" variant="outline" onClick={frameFromVideo}>
                  <Camera className="size-4" />
                  {t("sop.frameStep")}
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button size="sm" variant="outline" disabled={videoLoading} onClick={() => void showVideo()}>
                {videoLoading ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
                {t("sop.watch")}
              </Button>
            </div>
          )}
        </Card>
      ) : null}

      <div className="space-y-4">
        {steps.map((s, i) => (
          <Card key={s.id} className="gap-3 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-black">{i + 1}</span>
              <Input correct className="font-medium" value={s.title} placeholder={t("sop.stepTitlePh")} onChange={(e) => update(s.id, { title: e.target.value })} />
              <div className="flex shrink-0">
                <Button size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t("sop.up")} title={t("sop.up")} onClick={() => move(i, -1)}>
                  <ChevronUp className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={i === steps.length - 1} aria-label={t("sop.down")} title={t("sop.down")} onClick={() => move(i, 1)}>
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("exp.delete")}
                  title={t("exp.delete")}
                  onClick={() => {
                    setSteps((all) => all.filter((x) => x.id !== s.id));
                    touch();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <Textarea correct rows={2} value={s.text} placeholder={t("sop.stepTextPh")} onChange={(e) => update(s.id, { text: e.target.value })} />
            {s.image ? (
              <div className="space-y-2">
                <button type="button" onClick={() => setLightbox(s.image)} className="block w-full overflow-hidden rounded-lg border bg-muted/30">
                  <img src={s.image} alt="" className={cn("mx-auto max-h-80 w-auto object-contain")} />
                </button>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { replaceFor.current = s.id; fileInput.current?.click(); }}>
                    <ImagePlus className="size-4" />
                    {t("sop.replaceImage")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update(s.id, { image: null })}>
                    {t("sop.removeImage")}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button size="sm" variant="outline" onClick={() => { replaceFor.current = s.id; fileInput.current?.click(); }}>
                  <ImagePlus className="size-4" />
                  {t("sop.addImage")}
                </Button>
              </div>
            )}
          </Card>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSteps((s) => [...s, newStep()]);
              touch();
            }}
          >
            <Plus className="size-4" />
            {t("sop.addStep")}
          </Button>
          <Button variant="outline" onClick={() => { replaceFor.current = null; fileInput.current?.click(); }}>
            <ImagePlus className="size-4" />
            {t("sop.addFromFile")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("sop.pasteHint")}</p>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replaceFor.current;
          e.target.value = "";
          if (!file) return;
          void imageToJpeg(file).then((image) => {
            if (target) update(target, { image });
            else {
              setSteps((s) => [...s, newStep(image)]);
              touch();
            }
          });
        }}
      />

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{title || t("sop.untitled")}</DialogTitle>
          </DialogHeader>
          {lightbox ? <img src={lightbox} alt="" className="max-h-[75vh] w-full object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
