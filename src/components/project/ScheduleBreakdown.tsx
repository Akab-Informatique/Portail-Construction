import { useMemo, useState } from "react";
import { eq } from "drizzle-orm";
import { ArrowDown, ArrowUp, FileOutput, Loader2, Plus, PlusCircle } from "lucide-react";
import { db, schema } from "../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { projectColor } from "@/lib/project-colors";
import { buildBreakdown, durationLabel, periodLabel, shortDate, type BreakdownRow, type Task } from "@/lib/schedule-tree";
import { exportSchedulePdf } from "@/lib/schedule-pdf";
import type { Project, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const noteKey = (projectId: number, fr: boolean) => `frx.scheduleNote.${projectId}.${fr ? "fr" : "en"}`;

/**
 * Every task laid out as a sheet: phases as headings, their tasks indented underneath, each row numbered, with
 * duration, period, dates, weeks, status, who is responsible, progress and notes. The same sheet exports to PDF.
 */
export function ScheduleBreakdown({
  project,
  tasks,
  check,
  people,
  onOpen,
  onAdd,
  onChanged,
  readOnly = false,
}: {
  project: Project;
  tasks: Task[];
  check: Record<number, { done: number; total: number }>;
  people: User[];
  onOpen: (id: number) => void;
  /** Ask for a new phase (kind "phase") or a task under a phase. */
  onAdd: (kind: "phase" | "task", parentId: number | null) => void;
  onChanged: () => void;
  /** A client reads the breakdown and exports it; nothing can be added, moved or opened. */
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const color = projectColor(project);
  const rows = useMemo(() => buildBreakdown(tasks, check, project.start_date), [tasks, check, project.start_date]);
  const [exportOpen, setExportOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "";
  const responsibleOf = (row: BreakdownRow) => row.task.responsible || who(row.task.assigned_to) || "";
  const statusOf = (row: BreakdownRow) => t(`status.${row.task.status}` as MessageKey);

  function defaultNote() {
    return fr
      ? "Le présent échéancier est préliminaire et pourra être ajusté selon l’avancement des plans et devis, les délais d’approvisionnement, la disponibilité des intervenants et les conditions réelles de chantier."
      : "This schedule is preliminary and may be adjusted according to the progress of the plans and specifications, supply lead times, the availability of the people involved and actual site conditions.";
  }

  async function move(row: BreakdownRow, dir: -1 | 1) {
    const task = row.task;
    const topLevel = task.kind === "phase" || (task.kind === "break" && task.parent_id === null);
    const siblings = tasks
      .filter((x) => (topLevel ? x.kind === "phase" || (x.kind === "break" && x.parent_id === null) : x.parent_id === task.parent_id && x.kind !== "phase"))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const i = siblings.findIndex((x) => x.id === task.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    await Promise.all(siblings.map((x, index) => db.update(schema.project_tasks).set({ sort_order: index }).where(eq(schema.project_tasks.id, x.id))));
    onChanged();
  }

  async function doExport() {
    setBusy(true);
    try {
      try {
        localStorage.setItem(noteKey(project.id, fr), note);
      } catch {
        /* storage unavailable */
      }
      const years = rows.flatMap((r) => [r.start, r.end]).filter(Boolean).map((d) => Number(String(d).slice(0, 4)));
      const y0 = years.length ? Math.min(...years) : new Date().getFullYear();
      const y1 = years.length ? Math.max(...years) : y0;
      await exportSchedulePdf({
        projectName: project.name,
        yearRange: y0 === y1 ? String(y0) : `${y0}-${y1}`,
        rows,
        fr,
        note,
        locale,
        statusOf,
        responsibleOf,
        labels: {
          title: t("wbs.pdfTitle"),
          noteTitle: t("wbs.noteTitle"),
          steps: t("wbs.col.steps"),
          duration: t("wbs.col.duration"),
          period: t("wbs.col.period"),
          start: t("wbs.col.start"),
          end: t("wbs.col.end"),
          weekStart: t("wbs.col.weekStart"),
          weekEnd: t("wbs.col.weekEnd"),
          status: t("wbs.col.status"),
          responsible: t("wbs.col.responsible"),
          progress: t("wbs.col.progress"),
          notes: t("wbs.col.notes"),
          exportedOn: t("wbs.exportedOn"),
          page: t("wbs.page"),
          of: t("wbs.of"),
        },
      });
      setExportOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const head = ["", t("wbs.col.steps"), t("wbs.col.duration"), t("wbs.col.period"), t("wbs.col.start"), t("wbs.col.end"), t("wbs.col.weekStart"), t("wbs.col.weekEnd"), t("wbs.col.status"), t("wbs.col.responsible"), t("wbs.col.progress"), t("wbs.col.notes")];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {readOnly ? (
          <span />
        ) : (
          <Button variant="outline" onClick={() => onAdd("phase", null)}>
            <PlusCircle className="size-4" />
            {t("wbs.addPhase")}
          </Button>
        )}
        <Button
          onClick={() => {
            let saved = "";
            try {
              saved = localStorage.getItem(noteKey(project.id, fr)) ?? "";
            } catch {
              /* storage unavailable */
            }
            setNote(saved || defaultNote());
            setExportOpen(true);
          }}
          disabled={rows.length === 0}
        >
          <FileOutput className="size-4" />
          {t("wbs.export")}
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-neutral-500 text-left text-[10px] font-semibold text-white dark:bg-neutral-600">
                {head.map((h, i) => (
                  <th key={i} className={cn("border-r border-white/20 px-2 py-1.5", i === 0 && "w-8", i === 1 && "min-w-[300px]", i === 10 && "text-right")}>
                    {h}
                  </th>
                ))}
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="border-r px-2 text-[10px] text-muted-foreground">1</td>
                <td colSpan={11} className="px-3 py-2 font-display text-2xl tracking-wide" style={{ color: "#ed7d1e" }}>
                  {project.name}
                </td>
                <td />
              </tr>
              {rows.map((row) => {
                const isPhase = row.kind === "phase";
                const isBreak = row.kind === "break";
                const bg = isPhase ? `color-mix(in srgb, ${color} 22%, var(--card))` : isBreak ? "color-mix(in srgb, var(--foreground) 12%, var(--card))" : undefined;
                return (
                  <tr key={row.task.id} className={cn("group border-b border-border/70 transition-colors", !readOnly && "cursor-pointer hover:brightness-95")} style={{ background: bg }} onClick={() => !readOnly && onOpen(row.task.id)}>
                    <td className="border-r border-border/50 px-2 text-[10px] tabular-nums text-muted-foreground">{row.n}</td>
                    <td className={cn("border-r border-border/50 py-1.5 pr-2", isPhase || isBreak ? "font-bold" : "")} style={{ paddingLeft: row.depth === 1 ? 26 : 10 }}>
                      {row.task.title}
                    </td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap">{durationLabel(row, fr)}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap">{periodLabel(row, fr)}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap tabular-nums">{shortDate(row.start)}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap tabular-nums">{shortDate(row.end)}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap tabular-nums">{row.weekStart ?? ""}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap tabular-nums">{row.weekEnd ?? ""}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap">{isBreak ? "" : statusOf(row)}</td>
                    <td className="border-r border-border/50 px-2 whitespace-nowrap">{isBreak ? "" : responsibleOf(row)}</td>
                    <td className="border-r border-border/50 px-2 text-right tabular-nums">{isBreak ? "" : `${row.progress}%`}</td>
                    <td className="border-r border-border/50 px-2">{row.task.description ?? ""}</td>
                    <td className="px-1" onClick={(e) => e.stopPropagation()}>
                      <span className={cn("flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100", readOnly && "hidden")}>
                        {isPhase ? (
                          <button type="button" title={t("wbs.addTask")} aria-label={t("wbs.addTask")} className="rounded p-1 hover:bg-foreground/10" onClick={() => onAdd("task", row.task.id)}>
                            <Plus className="size-3.5" />
                          </button>
                        ) : null}
                        <button type="button" aria-label={t("pnav.up")} className="rounded p-1 hover:bg-foreground/10" onClick={() => void move(row, -1)}>
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button type="button" aria-label={t("pnav.down")} className="rounded p-1 hover:bg-foreground/10" onClick={() => void move(row, 1)}>
                          <ArrowDown className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("wbs.empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("wbs.export")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("wbs.noteLabel")}</Label>
            <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              {t("clients.cancel")}
            </Button>
            <Button onClick={() => void doExport()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileOutput className="size-4" />}
              {t("wbs.exportNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
