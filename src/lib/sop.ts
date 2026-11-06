import { desc, eq } from "drizzle-orm";
import { jsPDF } from "jspdf";
import { db, dbReady, schema } from "../db";
import { downloadBlob } from "./download";
import { FRX_INFO, headerImage } from "./forms-pdf";

/** One step of a procedure: a screenshot (or none), a title and what to do. */
export type SopStep = { id: string; title: string; text: string; image: string | null };
export type SopRow = typeof schema.sops.$inferSelect;

export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const CHUNK_BYTES = 3 * 1024 * 1024;
const IMG_MAX_W = 1400;

export const newStepId = () => Math.random().toString(36).slice(2, 10);
export const newStep = (image: string | null = null): SopStep => ({ id: newStepId(), title: "", text: "", image });

export function parseSteps(json: string | null | undefined): SopStep[] {
  try {
    const raw = JSON.parse(json ?? "[]") as Partial<SopStep>[];
    return raw.map((s) => ({ id: s.id || newStepId(), title: s.title ?? "", text: s.text ?? "", image: s.image ?? null }));
  } catch {
    return [];
  }
}

function drawToJpeg(source: CanvasImageSource, w: number, h: number, maxW: number, quality: number): string {
  const scale = Math.min(1, maxW / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** The picture on screen right now in a live capture (or a played video), as a small JPEG. */
export function frameToJpeg(video: HTMLVideoElement): string {
  return drawToJpeg(video, video.videoWidth, video.videoHeight, IMG_MAX_W, 0.72);
}

/** A picture file or pasted image, shrunk to a JPEG that stays light in the database. */
export async function imageToJpeg(file: Blob, maxW = IMG_MAX_W): Promise<string> {
  const bmp = await createImageBitmap(file);
  const out = drawToJpeg(bmp, bmp.width, bmp.height, maxW, 0.72);
  bmp.close();
  return out;
}

export async function thumbOf(dataUrl: string | null): Promise<string | null> {
  if (!dataUrl) return null;
  const blob = await (await fetch(dataUrl)).blob();
  return imageToJpeg(blob, 360);
}

// ---------------------------------------------------------------- screen capture

export type Capture = {
  video: HTMLVideoElement;
  recording: boolean;
  grab: () => string;
  /** Stops sharing and, when recording, gives the video. */
  stop: () => Promise<Blob | null>;
};

/** Asks the person which screen or window to share; optionally records it as video as well. */
export async function startCapture(record: boolean, onEnded: () => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  const chunks: Blob[] = [];
  let size = 0;
  let recorder: MediaRecorder | null = null;
  if (record && typeof MediaRecorder !== "undefined") {
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && size < MAX_VIDEO_BYTES) {
        chunks.push(e.data);
        size += e.data.size;
      }
    };
    recorder.start(2000);
  }
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    onEnded();
  };
  stream.getVideoTracks()[0]?.addEventListener("ended", finish);
  return {
    video,
    recording: !!recorder,
    grab: () => frameToJpeg(video),
    stop: async () => {
      ended = true;
      let blob: Blob | null = null;
      if (recorder && recorder.state !== "inactive") {
        blob = await new Promise<Blob>((resolve) => {
          recorder!.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
          recorder!.stop();
        });
      } else if (recorder) {
        blob = new Blob(chunks, { type: "video/webm" });
      }
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      return blob && blob.size > 0 ? blob : null;
    },
  };
}

// ---------------------------------------------------------------- database

export async function listSops() {
  await dbReady;
  return db
    .select({
      id: schema.sops.id,
      title: schema.sops.title,
      description: schema.sops.description,
      category: schema.sops.category,
      step_count: schema.sops.step_count,
      cover: schema.sops.cover,
      has_video: schema.sops.has_video,
      created_by: schema.sops.created_by,
      updated_at: schema.sops.updated_at,
    })
    .from(schema.sops)
    .orderBy(desc(schema.sops.updated_at));
}

export async function loadSop(id: number): Promise<SopRow | null> {
  await dbReady;
  const [row] = await db.select().from(schema.sops).where(eq(schema.sops.id, id)).limit(1);
  return row ?? null;
}

export async function saveSop(input: { id: number | null; title: string; description: string; category: string; steps: SopStep[]; hasVideo: boolean; userId: number | null }): Promise<number> {
  await dbReady;
  const cover = await thumbOf(input.steps.find((s) => s.image)?.image ?? null).catch(() => null);
  const values = {
    title: input.title.trim(),
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    steps: JSON.stringify(input.steps),
    step_count: input.steps.length,
    cover,
    has_video: input.hasVideo ? 1 : 0,
    updated_at: new Date(),
  };
  if (input.id) {
    await db.update(schema.sops).set(values).where(eq(schema.sops.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(schema.sops).values({ ...values, created_by: input.userId, created_at: new Date() }).returning({ id: schema.sops.id });
  return row.id;
}

export async function deleteSop(id: number) {
  await dbReady;
  await db.delete(schema.sop_media).where(eq(schema.sop_media.sop_id, id));
  await db.delete(schema.sops).where(eq(schema.sops.id, id));
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The recorded video, cut into pieces so no request gets too big; it replaces the earlier one. */
export async function saveVideo(sopId: number, blob: Blob) {
  await dbReady;
  await db.delete(schema.sop_media).where(eq(schema.sop_media.sop_id, sopId));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0, idx = 0; i < bytes.length; i += CHUNK_BYTES, idx++) {
    await db.insert(schema.sop_media).values({ sop_id: sopId, idx, mime: blob.type || "video/webm", data: toBase64(bytes.subarray(i, i + CHUNK_BYTES)) });
  }
}

export async function removeVideo(sopId: number) {
  await dbReady;
  await db.delete(schema.sop_media).where(eq(schema.sop_media.sop_id, sopId));
}

export async function loadVideo(sopId: number): Promise<Blob | null> {
  await dbReady;
  const rows = await db.select().from(schema.sop_media).where(eq(schema.sop_media.sop_id, sopId)).orderBy(schema.sop_media.idx);
  if (rows.length === 0) return null;
  const parts = rows.map((r) => Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
  return new Blob(parts as BlobPart[], { type: rows[0].mime });
}

// ---------------------------------------------------------------- export

type ExportInput = { title: string; description: string; category: string; steps: SopStep[]; author?: string; date: string; stepLabel: string; heading: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "sop";

/** One self-contained page (pictures inside it): it can be e-mailed, opened anywhere and printed. */
export async function exportSopHtml(x: ExportInput) {
  const banner = await headerImage();
  const steps = x.steps
    .map(
      (s, i) => `<section><h2><span>${i + 1}</span>${esc(s.title || `${x.stepLabel} ${i + 1}`)}</h2>${s.text ? `<p>${esc(s.text).replace(/\n/g, "<br>")}</p>` : ""}${s.image ? `<img src="${s.image}" alt="">` : ""}</section>`,
    )
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(x.title)}</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#141414;margin:0;background:#f4f4f2}.banner{display:block;width:100%;height:auto}.info{background:#fff;text-align:center;font-size:11px;color:#5f5f5c;padding:8px 12px;border-bottom:1px solid #e3e3df}header{max-width:860px;margin:0 auto;padding:22px 24px 0}header .tag{color:#b97a00}main{max-width:860px;margin:0 auto;padding:24px}h1{margin:0;font-size:28px}.meta{opacity:.75;font-size:13px;margin-top:6px}.tag{color:#fbaa19;font-size:12px;letter-spacing:.14em;text-transform:uppercase}section{background:#fff;border:1px solid #e3e3df;border-radius:12px;padding:18px;margin:18px 0;break-inside:avoid}h2{font-size:18px;margin:0 0 8px;display:flex;gap:10px;align-items:center}h2 span{background:#fbaa19;color:#000;border-radius:999px;min-width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-size:14px}img{max-width:100%;border:1px solid #e3e3df;border-radius:8px;margin-top:10px}p{line-height:1.5}@media print{body{background:#fff}section{border:0;padding:0}}</style></head>
<body>${banner ? `<img class="banner" src="${banner.data}" alt="">` : ""}<div class="info">${FRX_INFO.map(esc).join("<br>")}</div><header><div class="tag">${esc(x.heading)}</div><h1>${esc(x.title)}</h1><div class="meta">${esc([x.category, x.author, x.date].filter(Boolean).join(" · "))}</div></header><main>${x.description ? `<p>${esc(x.description).replace(/\n/g, "<br>")}</p>` : ""}${steps}</main></body></html>`;
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${fileSafe(x.title)}.html`);
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = src;
  });
}

export async function exportSopPdf(x: ExportInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const banner = await headerImage();
  const W = 210;
  const H = 297;
  const M = 16;
  const cw = W - M * 2;
  const ORANGE: [number, number, number] = [251, 170, 25];
  // The same header as the work order: the FRX banner across the page, the company details under it.
  let top = 24;
  if (banner) {
    top = (W * banner.h) / banner.w;
    doc.addImage(banner.data, "PNG", 0, 0, W, top, undefined, "FAST");
  } else {
    doc.setFillColor(20, 20, 20);
    doc.rect(0, 0, W, top, "F");
    doc.setFillColor(...ORANGE);
    doc.rect(0, top, W, 1.5, "F");
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(95, 95, 92);
  FRX_INFO.forEach((line, i) => doc.text(line, W / 2, top + 5 + i * 3.6, { align: "center" }));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(185, 122, 0);
  doc.text(x.heading.toUpperCase(), M, top + 18);
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 38);
  const titleLines = (doc.splitTextToSize(x.title, cw) as string[]).slice(0, 2);
  doc.text(titleLines, M, top + 26);
  doc.setFillColor(...ORANGE);
  doc.rect(M, top + 26 + titleLines.length * 7, 20, 1.2, "F");
  let y = top + 26 + titleLines.length * 7 + 8;
  doc.setTextColor(90, 90, 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text([x.category, x.author, x.date].filter(Boolean).join("  ·  "), M, y);
  y += 7;
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10.5);
  if (x.description) {
    const lines = doc.splitTextToSize(x.description, cw) as string[];
    doc.text(lines, M, y);
    y += lines.length * 5 + 4;
  }
  const room = (h: number) => {
    if (y + h > H - 16) {
      doc.addPage();
      y = M;
    }
  };
  for (let i = 0; i < x.steps.length; i++) {
    const s = x.steps[i];
    room(24);
    doc.setFillColor(...ORANGE);
    doc.circle(M + 4, y + 2, 4, "F");
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(String(i + 1), M + 4, y + 3.4, { align: "center" });
    doc.setFontSize(12.5);
    doc.setTextColor(20, 20, 20);
    doc.text(doc.splitTextToSize(s.title || `${x.stepLabel} ${i + 1}`, cw - 12).slice(0, 2), M + 11, y + 3);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    if (s.text) {
      const lines = doc.splitTextToSize(s.text, cw) as string[];
      for (const line of lines) {
        room(6);
        doc.text(line, M, y);
        y += 5;
      }
      y += 2;
    }
    if (s.image) {
      const { w, h } = await imageSize(s.image);
      const iw = Math.min(cw, 150);
      let ih = (iw * h) / w;
      let drawW = iw;
      const maxH = H - M * 2 - 8;
      if (ih > maxH) {
        ih = maxH;
        drawW = (ih * w) / h;
      }
      room(ih + 2);
      doc.addImage(s.image, "JPEG", M, y, drawW, ih);
      doc.setDrawColor(210, 210, 205);
      doc.rect(M, y, drawW, ih);
      y += ih + 4;
    }
    y += 6;
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`${x.title}  ·  ${p}/${pages}`, W / 2, H - 8, { align: "center" });
  }
  doc.save(`${fileSafe(x.title)}.pdf`);
}
