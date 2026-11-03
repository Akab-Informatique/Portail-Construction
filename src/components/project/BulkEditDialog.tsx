import { useMemo, useState } from "react";
import { eq } from "drizzle-orm";
import { Loader2, Save } from "lucide-react";
import { db, schema } from "../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { TASK_STATUSES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import { projectColor } from "@/lib/project-colors";
import { useAuth } from "@/lib/auth";
import type { Project } from "@/lib/types";
import type { Task } from "@/components/project/TaskDrawer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Draft = { title?: string; start_date?: string | null; end_date?: string | null; status?: string; responsible?: string | null; progress?: number | null };

/**
 * The whole schedule in one editable table: every phase and task with its title, dates, status, responsible and progress.
 * Change as many cells as needed, then save once. Only the rows that were touched are written.
 */
export function BulkEditDialog({ open, project, tasks, onClose, onSaved }: { open: boolean; project: Project; tasks: Task[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const color = projectColor(project);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState(false);

  // Phases in order, each followed by its tasks; tasks without a phase last.
  const rows = useMemo(() => {
    const phases = tasks.filter((x) => x.kind === "phase").sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const byParent = (pid: number | null) => tasks.filter((x) => x.kind !== "phase" && (x.parent_id ?? null) === pid).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return [...phases.flatMap((p) => [p, ...byParent(p.id)]), ...byParent(null)];
  }, [tasks]);

  const value = <K extends keyof Draft>(task: Task, key: K): Draft[K] => (draft[task.id] && key in draft[task.id] ? draft[task.id][key] : (task[key as keyof Task] as Draft[K]));
  const set = (id: number, patch: Draft) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const changed = Object.keys(draft).length;

  async function save() {
    setBusy(true);
    try {
      for (const [id, patch] of Object.entries(draft)) {
        const clean: Draft = { ...patch };
        if (clean.title !== undefined && !clean.title.trim()) delete clean.title;
        if (clean.title !== undefined) clean.title = clean.title.trim();
        await db.update(schema.project_tasks).set({ ...clean, updated_on: todayISO() }).where(eq(schema.project_tasks.id, Number(id)));
      }
      await logActivity({ action: "edited schedule", details: t("sch.bulkLog", { n: changed }), projectId: project.id, userId: user?.id });
      setDraft({});
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const cell = "border-r border-border/50 px-1.5 py-1";
  const input = "h-8 border-transparent bg-transparent px-1.5 text-sm shadow-none hover:border-input focus-visible:bg-background";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[94vh] flex-col gap-3 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-6 py-4" style={{ boxShadow: `inset 0 4px 0 ${color}` }}>
          <DialogTitle className="font-display text-2xl uppercase tracking-wide">{t("sch.bulkTitle")}</DialogTitle>
          <DialogDescription>{t("sch.bulkDesc")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">{t("sch.bulkCol.title")}</th>
                <th className="w-36 px-2 py-2 font-medium">{t("sch.start")}</th>
                <th className="w-36 px-2 py-2 font-medium">{t("sch.end")}</th>
                <th className="w-40 px-2 py-2 font-medium">{t("project.status")}</th>
                <th className="w-44 px-2 py-2 font-medium">{t("wbs.col.responsible")}</th>
                <th className="w-24 px-2 py-2 font-medium">{t("wbs.col.progress")} %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => {
                const isPhase = task.kind === "phase";
                const touched = Boolean(draft[task.id]);
                return (
                  <tr key={task.id} className={cn("border-b border-border/70", touched && "bg-primary/5")} style={isPhase ? { background: `color-mix(in srgb, ${color} 16%, var(--card))` } : undefined}>
                    <td className={cell} style={{ paddingLeft: isPhase || !task.parent_id ? 6 : 24 }}>
                      <Input className={cn(input, isPhase && "font-bold")} value={(value(task, "title") as string) ?? ""} onChange={(e) => set(task.id, { title: e.target.value })} />
                    </td>
                    <td className={cell}>
                      <Input type="date" className={input} value={(value(task, "start_date") as string | null) ?? ""} onChange={(e) => set(task.id, { start_date: e.target.value || null })} />
                    </td>
                    <td className={cell}>
                      <Input type="date" className={input} value={(value(task, "end_date") as string | null) ?? ""} onChange={(e) => set(task.id, { end_date: e.target.value || null })} />
                    </td>
                    <td className={cell}>
                      {task.kind === "break" ? null : (
                        <select className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-input" value={(value(task, "status") as string) ?? "not_started"} onChange={(e) => set(task.id, { status: e.target.value })}>
                          {TASK_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {t(`status.${s.value}` as MessageKey)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={cell}>
                      {task.kind === "break" ? null : <Input className={input} value={(value(task, "responsible") as string | null) ?? ""} onChange={(e) => set(task.id, { responsible: e.target.value || null })} />}
                    </td>
                    <td className="px-1.5 py-1">
                      {task.kind === "break" ? null : (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder={t("wbs.auto")}
                          className={input}
                          value={(value(task, "progress") as number | null) ?? ""}
                          onChange={(e) => set(task.id, { progress: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          <span className="text-sm text-muted-foreground">{t("sch.bulkChanged", { n: changed })}</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              {t("clients.cancel")}
            </Button>
            <Button disabled={busy || changed === 0} onClick={() => void save()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("sch.bulkSave")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
