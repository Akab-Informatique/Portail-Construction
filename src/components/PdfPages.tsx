import { useEffect, useRef, useState } from "react";
import { PenLine, Trash2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SignField } from "@/lib/sign-fields";

type PageInfo = { n: number; ratio: number };

/** What the client signed: shown inside the signature and date boxes of the document. */
export type SignedValues = { signature: string | null; dateText: string; name?: string | null };

/**
 * A PDF drawn page by page, with red boxes on top where the client signs and dates it.
 *  - "edit": staff add, move, resize and remove the boxes.
 *  - "view": the boxes show where to sign (click to sign when allowed) or, once accepted, the signature and the date.
 * Positions are fractions of the page (0..1), so they stay in place at any size.
 */
export function PdfPages({
  url,
  fields,
  mode,
  onChange,
  signed,
  canSign,
  onSign,
}: {
  url: string;
  fields: SignField[];
  mode: "view" | "edit";
  onChange?: (fields: SignField[]) => void;
  signed?: SignedValues | null;
  canSign?: boolean;
  onSign?: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const canvases = useRef<Record<number, HTMLCanvasElement | null>>({});
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  const [tool, setTool] = useState<"signature" | "date" | null>(null);
  const docRef = useRef<any>(null);

  // measure the available width
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // load the document
  useEffect(() => {
    let alive = true;
    setError(false);
    setPages([]);
    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("fetch");
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        if (!alive) return;
        docRef.current = doc;
        const infos: PageInfo[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n);
          const v = p.getViewport({ scale: 1 });
          infos.push({ n, ratio: v.height / v.width });
        }
        if (alive) setPages(infos);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  // Draw the pages at the current width. Each page is painted on a private canvas and copied over in one go, and only the latest
  // request may paint: two renders on the same canvas (the dialog changes size while it opens) used to mix up and flip the page.
  const generation = useRef(0);
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !width || pages.length === 0) return;
    const mine = ++generation.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (const info of pages) {
          if (generation.current !== mine) return;
          const target = canvases.current[info.n];
          if (!target) continue;
          const page = await doc.getPage(info.n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const work = document.createElement("canvas");
          work.width = Math.floor(viewport.width);
          work.height = Math.floor(viewport.height);
          const ctx = work.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, work.width, work.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (generation.current !== mine) return;
          target.width = work.width;
          target.height = work.height;
          target.getContext("2d")?.drawImage(work, 0, 0);
        }
      })().catch(() => undefined);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pages, width]);

  const edit = mode === "edit";
  const set = (next: SignField[]) => onChange?.(next);
  const update = (id: string, patch: Partial<SignField>) => set(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  function place(e: React.MouseEvent<HTMLDivElement>, page: number) {
    if (!edit || !tool) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = tool === "signature" ? 0.32 : 0.22;
    const h = tool === "signature" ? 0.06 : 0.032;
    const x = Math.min(Math.max((e.clientX - rect.left) / rect.width - w / 2, 0), 1 - w);
    const y = Math.min(Math.max((e.clientY - rect.top) / rect.height - h / 2, 0), 1 - h);
    set([...fields, { id: Math.random().toString(36).slice(2, 9), type: tool, page, x, y, w, h }]);
    setTool(null);
  }

  /** Drag the box (move) or its corner (resize) with the pointer. */
  function drag(e: React.PointerEvent, f: SignField, kind: "move" | "resize") {
    if (!edit) return;
    e.preventDefault();
    e.stopPropagation();
    const pageEl = (e.currentTarget as HTMLElement).closest("[data-page]") as HTMLElement;
    const rect = pageEl.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...f };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width;
      const dy = (ev.clientY - sy) / rect.height;
      if (kind === "move") update(f.id, { x: Math.min(Math.max(start.x + dx, 0), 1 - start.w), y: Math.min(Math.max(start.y + dy, 0), 1 - start.h) });
      else update(f.id, { w: Math.min(Math.max(start.w + dx, 0.05), 1 - start.x), h: Math.min(Math.max(start.h + dy, 0.02), 1 - start.y) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="space-y-2">
      {edit ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
          <Button type="button" size="sm" variant={tool === "signature" ? "default" : "outline"} onClick={() => setTool(tool === "signature" ? null : "signature")}>
            <PenLine className="size-3.5" />
            {t("sf.addSignature")}
          </Button>
          <Button type="button" size="sm" variant={tool === "date" ? "default" : "outline"} onClick={() => setTool(tool === "date" ? null : "date")}>
            <CalendarDays className="size-3.5" />
            {t("sf.addDate")}
          </Button>
          <p className="text-xs text-muted-foreground">{tool ? t("sf.clickPage") : t("sf.editHint")}</p>
        </div>
      ) : null}
      <div ref={box} className="max-h-[68vh] space-y-3 overflow-y-auto rounded-md border bg-muted/30 p-2">
        {error ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("billing.view.missing")}</p> : null}
        {!error && pages.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("billing.file.loading")}</p> : null}
        {pages.map((info) => (
          <div
            key={info.n}
            data-page={info.n}
            className={cn("relative mx-auto bg-white shadow-sm", edit && tool && "cursor-crosshair")}
            style={{ width: "100%", aspectRatio: `1 / ${info.ratio}` }}
            onClick={(e) => place(e, info.n)}
          >
            <canvas ref={(el) => void (canvases.current[info.n] = el)} className="absolute inset-0 h-full w-full" />
            {fields
              .filter((f) => f.page === info.n)
              .map((f) => {
                const filled = Boolean(signed) && !edit;
                const clickable = !edit && !filled && canSign;
                return (
                  <div
                    key={f.id}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={(e) => {
                      if (clickable) {
                        e.stopPropagation();
                        onSign?.();
                      }
                    }}
                    onKeyDown={(e) => clickable && (e.key === "Enter" || e.key === " ") && onSign?.()}
                    onPointerDown={(e) => drag(e, f, "move")}
                    className={cn(
                      "absolute flex items-center justify-center overflow-hidden",
                      filled ? "border border-transparent" : "border-2 border-dashed border-red-500 bg-red-500/10",
                      edit && "cursor-move touch-none",
                      clickable && "cursor-pointer animate-pulse hover:bg-red-500/20",
                    )}
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                  >
                    {filled ? (
                      f.type === "signature" ? (
                        signed!.signature ? <img src={signed!.signature} alt="" className="h-full w-full object-contain" draggable={false} /> : null
                      ) : (
                        <span className="whitespace-nowrap font-medium text-slate-900" style={{ fontSize: Math.max(8, Math.min(14, width * f.w * 0.075)) }}>
                          {signed!.dateText}
                        </span>
                      )
                    ) : (
                      <span className="pointer-events-none px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-red-600">
                        {f.type === "signature" ? t("sf.signHere") : t("sf.dateHere")}
                      </span>
                    )}
                    {edit ? (
                      <>
                        <button
                          type="button"
                          aria-label={t("sf.remove")}
                          className="absolute right-0 top-0 rounded-bl bg-red-600 p-0.5 text-white"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            set(fields.filter((x) => x.id !== f.id));
                          }}
                        >
                          <Trash2 className="size-3" />
                        </button>
                        <span className="absolute bottom-0 right-0 size-3 cursor-nwse-resize touch-none bg-red-600" onPointerDown={(e) => drag(e, f, "resize")} />
                      </>
                    ) : null}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
