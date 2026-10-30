import { useEffect, useRef, useState } from "react";
import { CalendarRange, FileUp, Loader2, Snowflake, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import { importSchedule, readSchedulePdf } from "@/lib/schedule-pdf-import";
import type { ParsedSchedule } from "@/lib/schedule-pdf-parse";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Builds the project's schedule from a PDF: the phases and their tasks are read from the file, shown for checking, then
 * created, and appear at once in the task list, the breakdown, the calendar and the Gantt.
 */
export function ScheduleImportDialog({
  open,
  project,
  existing,
  userId,
  onClose,
  onDone,
}: {
  open: boolean;
  project: Project;
  /** How many phases and tasks the project already has. */
  existing: number;
  userId?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSchedule | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [replace, setReplace] = useState(false);
  const [setDates, setSetDates] = useState(true);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setParsed(null);
    setError(null);
    setReplace(false);
    setSetDates(!project.start_date || !project.end_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function pick(next: File | undefined | null) {
    if (!next) return;
    if (next.type !== "application/pdf" && !/\.pdf$/i.test(next.name)) {
      setError(t("simp.notPdf"));
      return;
    }
    setFile(next);
    setParsed(null);
    setError(null);
    setReading(true);
    try {
      const result = await readSchedulePdf(next);
      if (result.phases.length === 0) setError(t("simp.unreadable"));
      else setParsed(result);
    } catch {
      setError(t("simp.unreadable"));
    } finally {
      setReading(false);
    }
  }

  const taskCount = parsed?.phases.reduce((n, p) => n + p.tasks.length, 0) ?? 0;
  const starts = (parsed?.phases ?? []).map((p) => p.start).filter((d): d is string => Boolean(d)).sort();
  const ends = (parsed?.phases ?? []).map((p) => p.end).filter((d): d is string => Boolean(d)).sort();

  async function run() {
    if (!parsed) return;
    if (replace && !window.confirm(t("simp.replaceConfirm", { n: existing }))) return;
    setBusy(true);
    setError(null);
    try {
      const made = await importSchedule(project.id, parsed, { replace, setProjectDates: setDates });
      await logActivity({ action: "imported schedule", details: `${file?.name ?? "PDF"} · ${made.phases} / ${made.tasks}`, projectId: project.id, userId });
      onDone();
      onClose();
    } catch {
      setError(t("simp.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="size-5" />
            {t("simp.title")}
          </DialogTitle>
          <DialogDescription>{t("simp.hint")}</DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void pick(e.dataTransfer.files?.[0]);
          }}
          className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors", dragging ? "border-primary bg-primary/10" : "hover:border-primary/60")}
        >
          {reading ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <FileUp className="size-6 text-muted-foreground" />}
          <p className="text-sm font-medium">{file ? file.name : t("simp.drop")}</p>
          <p className="text-xs text-muted-foreground">{reading ? t("simp.reading") : t("simp.formats")}</p>
          <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        {error ? (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {parsed ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <p className="font-medium">{parsed.title ?? file?.name}</p>
              <p className="text-muted-foreground">
                {t("simp.found", { phases: parsed.phases.length, tasks: taskCount })}
                {starts[0] && ends.length ? ` · ${formatDate(starts[0], locale)} → ${formatDate(ends[ends.length - 1], locale)}` : ""}
              </p>
            </div>

            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {parsed.phases.map((phase, i) => (
                <li key={`${phase.title}-${i}`} className="px-4 py-2.5 text-sm">
                  <div className="flex items-start gap-2">
                    {phase.kind === "break" ? <Snowflake className="mt-0.5 size-4 shrink-0 text-sky-500" /> : <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[11px] font-bold tabular-nums">{i + 1}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{phase.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {phase.start ? formatDate(phase.start, locale) : "—"} → {phase.end ? formatDate(phase.end, locale) : "—"}
                        {phase.kind === "break" ? ` · ${t("simp.break")}` : ` · ${t("simp.tasks", { n: phase.tasks.length })}`}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="space-y-2 text-sm">
              {existing > 0 ? (
                <div className="space-y-1.5 rounded-lg border px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("simp.existing", { n: existing })}</p>
                  {([false, true] as const).map((v) => (
                    <label key={String(v)} className="flex cursor-pointer items-start gap-2">
                      <input type="radio" className="mt-1" name="mode" checked={replace === v} onChange={() => setReplace(v)} />
                      <span>
                        <span className="font-medium">{v ? t("simp.replace") : t("simp.add")}</span>
                        <span className="block text-xs text-muted-foreground">{v ? t("simp.replaceHint") : t("simp.addHint")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-1" checked={setDates} onChange={(e) => setSetDates(e.target.checked)} />
                <span>{t("simp.setDates")}</span>
              </label>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={() => void run()} disabled={!parsed || busy || reading}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarRange className="size-4" />}
            {t("simp.import", { n: parsed?.phases.length ?? 0, tasks: taskCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
