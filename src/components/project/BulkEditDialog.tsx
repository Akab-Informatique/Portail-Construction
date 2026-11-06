import { useEffect, useMemo, useState } from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { ArrowDown, ArrowUp, FolderPlus, Loader2, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import { db, schema } from "../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { TASK_STATUSES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import { projectColor } from "@/lib/project-colors";
import { removeAttachmentsOf } from "@/lib/project-files";
import { useAuth } from "@/lib/auth";
import type { Project } from "@/lib/types";
import type { Task } from "@/components/project/TaskDrawer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Row = {
  id: number;
  kind: string;
  parent: number | null;
  title: string;
  start: string | null;
  end: string | null;
  status: string;
  responsible: string | null;
  progress: number | null;
  /** A note to add to the task's thread when saving. */
  newNote: string;
  deleted: boolean;
  isNew: boolean;
};

const fromTask = (x: Task): Row => ({ id: x.id, kind: x.kind, parent: x.parent_id, title: x.title, start: x.start_date, end: x.end_date, status: x.status, responsible: x.responsible, progress: x.progress, newNote: "", deleted: false, isNew: false });

/** Phases in order, each followed by its tasks; tasks without a phase last. */
function ordered(tasks: Task[]): Row[] {
  const phases = tasks.filter((x) => x.kind === "phase").sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const under = (pid: number | null) => tasks.filter((x) => x.kind !== "phase" && (x.parent_id ?? null) === pid).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return [...phases.flatMap((p) => [p, ...under(p.id)]), ...under(null)].map(fromTask);
}

/**
 * The whole schedule in one table: change any cell, add a phase or a task, delete rows, move them up or down, and add a
 * note to any task. Nothing is written until "Save all changes".
 */
export function BulkEditDialog({ open, project, tasks, scheduleId, onClose, onSaved }: { open: boolean; project: Project; tasks: Task[]; scheduleId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const color = projectColor(project);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [noteInfo, setNoteInfo] = useState<Record<number, { n: number; last: string }>>({});
  const [seq, setSeq] = useState(-1);

  // Start from the schedule as it is each time the table opens.
  useEffect(() => {
    if (!open) return;
    setRows(ordered(tasks));
    setSeq(-1);
    void (async () => {
      const ids = tasks.map((x) => x.id);
      if (!ids.length) return setNoteInfo({});
      const all = await db.select().from(schema.task_notes).where(inArray(schema.task_notes.task_id, ids)).orderBy(desc(schema.task_notes.id));
      const info: Record<number, { n: number; last: string }> = {};
      for (const n of all) info[n.task_id] = { n: (info[n.task_id]?.n ?? 0) + 1, last: info[n.task_id]?.last ?? n.body };
      setNoteInfo(info);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (id: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));

  /** Moves a row (a phase with its tasks) one place up or down among its siblings. */
  function move(id: number, dir: -1 | 1) {
    setRows((list) => {
      const row = list.find((x) => x.id === id);
      if (!row) return list;
      // blocks: a phase and its tasks are one block; a task is a block of one among the tasks of its phase
      const isPhase = row.kind === "phase";
      const blockOf = (x: Row) => (x.kind === "phase" ? [x, ...list.filter((c) => c.parent === x.id && c.kind !== "phase")] : [x]);
      const siblings = list.filter((x) => (isPhase ? x.kind === "phase" : x.kind !== "phase" && x.parent === row.parent));
      const at = siblings.findIndex((x) => x.id === id);
      const other = siblings[at + dir];
      if (!other) return list;
      const a = blockOf(row).map((x) => x.id);
      const b = blockOf(other).map((x) => x.id);
      const next: Row[] = [];
      const first = dir === -1 ? b : a;
      const second = dir === -1 ? a : b;
      let placed = false;
      for (const x of list) {
        if (first.includes(x.id) || second.includes(x.id)) {
          if (!placed) {
            placed = true;
            next.push(...first.map((i) => list.find((y) => y.id === i)!), ...second.map((i) => list.find((y) => y.id === i)!));
          }
          continue;
        }
        next.push(x);
      }
      return next;
    });
  }

  function add(kind: "phase" | "task", parent: number | null) {
    const id = seq;
    setSeq(seq - 1);
    const fresh: Row = { id, kind, parent, title: "", start: null, end: null, status: "not_started", responsible: null, progress: null, newNote: "", deleted: false, isNew: true };
    setRows((list) => {
      if (kind === "phase") return [...list.filter((x) => !(x.kind !== "phase" && x.parent === null)), fresh, ...list.filter((x) => x.kind !== "phase" && x.parent === null)];
      if (parent === null) return [...list, fresh];
      // at the end of its phase
      const last = list.map((x, i) => (x.id === parent || x.parent === parent ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
      return [...list.slice(0, last + 1), fresh, ...list.slice(last + 1)];
    });
  }

  const changes = useMemo(() => {
    const byId = new Map(tasks.map((x) => [x.id, x]));
    return rows.filter((r) => {
      if (r.isNew) return !r.deleted;
      const o = byId.get(r.id);
      if (!o) return false;
      return r.deleted || r.title !== o.title || r.start !== o.start_date || r.end !== o.end_date || r.status !== o.status || r.responsible !== o.responsible || r.progress !== o.progress || r.newNote.trim() !== "";
    }).length;
  }, [rows, tasks]);
  const orderChanged = useMemo(() => {
    const before = ordered(tasks).map((x) => x.id).join(",");
    return before !== rows.filter((r) => !r.isNew).map((x) => x.id).join(",");
  }, [rows, tasks]);

  async function save() {
    setBusy(true);
    try {
      const live = rows.filter((r) => !r.deleted);
      const realId = new Map<number, number>(live.filter((r) => !r.isNew).map((r) => [r.id, r.id]));
      const byId = new Map(tasks.map((x) => [x.id, x]));
      const today = todayISO();
      // Rows removed: everything hanging on them goes too; the tasks of a removed phase stay, without a phase.
      for (const r of rows.filter((x) => x.deleted && !x.isNew)) {
        await db.delete(schema.task_checklist).where(eq(schema.task_checklist.task_id, r.id));
        await db.delete(schema.task_notes).where(eq(schema.task_notes.task_id, r.id));
        await db.delete(schema.task_dependencies).where(eq(schema.task_dependencies.task_id, r.id));
        await db.delete(schema.task_dependencies).where(eq(schema.task_dependencies.depends_on_id, r.id));
        await removeAttachmentsOf(project.id, "task", r.id).catch(() => undefined);
        if (r.kind === "phase") await db.update(schema.project_tasks).set({ parent_id: null }).where(eq(schema.project_tasks.parent_id, r.id));
        await db.delete(schema.project_tasks).where(eq(schema.project_tasks.id, r.id));
      }
      // New phases first, so the new tasks under them can point at the real row.
      const position = (r: Row) => (r.kind === "phase" ? live.filter((x) => x.kind === "phase").indexOf(r) : live.filter((x) => x.kind !== "phase" && x.parent === r.parent).indexOf(r));
      for (const r of live.filter((x) => x.isNew && x.kind === "phase")) {
        const [row] = await db
          .insert(schema.project_tasks)
          .values({ project_id: project.id, schedule_id: scheduleId, title: r.title.trim() || t("sch.bulkUntitled"), start_date: r.start, end_date: r.end, status: r.status, priority: "medium", kind: "phase", parent_id: null, sort_order: position(r), responsible: r.responsible, progress: r.progress, updated_on: today })
          .returning({ id: schema.project_tasks.id });
        realId.set(r.id, row.id);
      }
      for (const r of live) {
        const parentReal = r.parent === null ? null : (realId.get(r.parent) ?? null);
        if (r.isNew && r.kind !== "phase") {
          const [row] = await db
            .insert(schema.project_tasks)
            .values({ project_id: project.id, schedule_id: scheduleId, title: r.title.trim() || t("sch.bulkUntitled"), start_date: r.start, end_date: r.end, status: r.status, priority: "medium", kind: "task", parent_id: parentReal, sort_order: position(r), responsible: r.responsible, progress: r.progress, updated_on: today })
            .returning({ id: schema.project_tasks.id });
          realId.set(r.id, row.id);
        } else if (!r.isNew) {
          const o = byId.get(r.id);
          if (!o) continue;
          const values = { title: r.title.trim() || o.title, start_date: r.start, end_date: r.end, status: r.status, responsible: r.responsible, progress: r.progress, parent_id: parentReal, sort_order: position(r) };
          const same = values.title === o.title && values.start_date === o.start_date && values.end_date === o.end_date && values.status === o.status && values.responsible === o.responsible && values.progress === o.progress && values.parent_id === o.parent_id && values.sort_order === o.sort_order;
          if (!same) await db.update(schema.project_tasks).set({ ...values, updated_on: today }).where(eq(schema.project_tasks.id, r.id));
        }
        const note = r.newNote.trim();
        const id = realId.get(r.id);
        if (note && id) {
          await db.insert(schema.task_notes).values({ project_id: project.id, task_id: id, user_id: user?.id ?? null, body: note });
          await db.update(schema.project_tasks).set({ updated_on: today }).where(eq(schema.project_tasks.id, id));
        }
      }
      await logActivity({ action: "edited schedule", details: t("sch.bulkLog", { n: changes }), projectId: project.id, userId: user?.id });
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
      <DialogContent className="flex max-h-[94vh] flex-col gap-3 p-0 sm:max-w-7xl">
        <DialogHeader className="border-b px-6 py-4" style={{ boxShadow: `inset 0 4px 0 ${color}` }}>
          <DialogTitle className="font-display text-2xl uppercase tracking-wide">{t("sch.bulkTitle")}</DialogTitle>
          <DialogDescription>{t("sch.bulkDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 px-6">
          <Button type="button" size="sm" variant="outline" onClick={() => add("phase", null)}>
            <FolderPlus className="size-4" />
            {t("sch.bulkAddPhase")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => add("task", null)}>
            <Plus className="size-4" />
            {t("sch.bulkAddTask")}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-20 px-2 py-2 font-medium" />
                <th className="px-2 py-2 font-medium">{t("sch.bulkCol.title")}</th>
                <th className="w-36 px-2 py-2 font-medium">{t("sch.start")}</th>
                <th className="w-36 px-2 py-2 font-medium">{t("sch.end")}</th>
                <th className="w-36 px-2 py-2 font-medium">{t("project.status")}</th>
                <th className="w-36 px-2 py-2 font-medium">{t("wbs.col.responsible")}</th>
                <th className="w-20 px-2 py-2 font-medium">{t("wbs.col.progress")} %</th>
                <th className="w-64 px-2 py-2 font-medium">{t("sch.notes")}</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => {
                const isPhase = task.kind === "phase";
                const info = noteInfo[task.id];
                return (
                  <tr key={task.id} className={cn("border-b border-border/70", task.deleted && "opacity-40", task.isNew && "bg-primary/5")} style={isPhase ? { background: `color-mix(in srgb, ${color} 16%, var(--card))` } : undefined}>
                    <td className={cell}>
                      <span className="flex items-center gap-0.5">
                        <button type="button" aria-label={t("pnav.up")} className="rounded p-1 hover:bg-foreground/10" onClick={() => move(task.id, -1)}>
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button type="button" aria-label={t("pnav.down")} className="rounded p-1 hover:bg-foreground/10" onClick={() => move(task.id, 1)}>
                          <ArrowDown className="size-3.5" />
                        </button>
                        {isPhase ? (
                          <button type="button" title={t("wbs.addTask")} aria-label={t("wbs.addTask")} className="rounded p-1 hover:bg-foreground/10" onClick={() => add("task", task.id)}>
                            <Plus className="size-3.5" />
                          </button>
                        ) : null}
                      </span>
                    </td>
                    <td className={cell} style={{ paddingLeft: isPhase || !task.parent ? 6 : 24 }}>
                      <Input className={cn(input, isPhase && "font-bold", task.deleted && "line-through")} value={task.title} placeholder={task.isNew ? t("sch.bulkNewTitle") : undefined} onChange={(e) => patch(task.id, { title: e.target.value })} />
                    </td>
                    <td className={cell}>
                      <Input type="date" className={input} value={task.start ?? ""} onChange={(e) => patch(task.id, { start: e.target.value || null })} />
                    </td>
                    <td className={cell}>
                      <Input type="date" className={input} value={task.end ?? ""} onChange={(e) => patch(task.id, { end: e.target.value || null })} />
                    </td>
                    <td className={cell}>
                      {task.kind === "break" ? null : (
                        <select className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-input" value={task.status} onChange={(e) => patch(task.id, { status: e.target.value })}>
                          {TASK_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {t(`status.${s.value}` as MessageKey)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={cell}>{task.kind === "break" ? null : <Input className={input} value={task.responsible ?? ""} onChange={(e) => patch(task.id, { responsible: e.target.value || null })} />}</td>
                    <td className={cell}>
                      {task.kind === "break" ? null : (
                        <Input type="number" min={0} max={100} placeholder={t("wbs.auto")} className={input} value={task.progress ?? ""} onChange={(e) => patch(task.id, { progress: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) })} />
                      )}
                    </td>
                    <td className={cell}>
                      {task.kind === "break" ? null : (
                        <div className="flex items-center gap-1">
                          {info ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold" title={info.last}>
                              <MessageSquare className="size-3" />
                              {info.n}
                            </span>
                          ) : null}
                          <Input className={input} value={task.newNote} placeholder={info ? info.last.slice(0, 40) : t("sch.bulkAddNote")} onChange={(e) => patch(task.id, { newNote: e.target.value })} />
                        </div>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        aria-label={t("exp.delete")}
                        title={t("exp.delete")}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => (task.isNew ? setRows((r) => r.filter((x) => x.id !== task.id)) : patch(task.id, { deleted: !task.deleted }))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("wbs.empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          <span className="text-sm text-muted-foreground">{t("sch.bulkChanged", { n: changes })}{orderChanged ? ` · ${t("sch.bulkOrder")}` : ""}</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              {t("clients.cancel")}
            </Button>
            <Button disabled={busy || (changes === 0 && !orderChanged)} onClick={() => void save()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("sch.bulkSave")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
