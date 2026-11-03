import { useEffect, useState } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { CalendarDays, CheckCircle2, Circle, ListChecks, Lock, MessageSquare, Pencil, User } from "lucide-react";
import { db, schema } from "../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { formatDate, formatDateTime } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import type { Dep } from "@/lib/schedule-forecast";
import type { Project, User as Person } from "@/lib/types";
import { Attachments } from "@/components/project/Attachments";
import type { Task } from "@/components/project/TaskDrawer";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type CheckItem = typeof schema.task_checklist.$inferSelect;
type TaskNote = typeof schema.task_notes.$inferSelect;

const DAY = 86400000;
const spanDays = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY) + 1;

/**
 * A task or a phase in a pop-up, to read: its dates, status, progress, who is on it, what it waits for, its checklist, notes
 * and files (a phase also lists its tasks). A client account sees the basic facts only. Staff can jump to editing from here.
 */
export function TaskDetailDialog({
  project,
  task,
  tasks,
  deps,
  people,
  viewer,
  onClose,
  onEdit,
  onNavigate,
}: {
  project: Project;
  task: Task | null;
  tasks: Task[];
  deps: Dep[];
  people: Person[];
  viewer: boolean;
  onClose: () => void;
  onEdit: (id: number) => void;
  onNavigate: (id: number) => void;
}) {
  const { t, locale } = useI18n();
  const color = projectColor(project);
  const [check, setCheck] = useState<CheckItem[]>([]);
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const id = task?.id ?? 0;

  useEffect(() => {
    if (!id || viewer) {
      setCheck([]);
      setNotes([]);
      return;
    }
    void (async () => {
      const [c, n] = await Promise.all([
        db.select().from(schema.task_checklist).where(eq(schema.task_checklist.task_id, id)).orderBy(asc(schema.task_checklist.sort_order), asc(schema.task_checklist.id)),
        db.select().from(schema.task_notes).where(eq(schema.task_notes.task_id, id)).orderBy(desc(schema.task_notes.id)),
      ]);
      setCheck(c);
      setNotes(n);
    })();
  }, [id, viewer]);

  if (!task) return null;
  const isPhase = task.kind === "phase";
  const children = isPhase ? tasks.filter((x) => x.parent_id === task.id).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) : [];
  const phase = task.parent_id ? tasks.find((x) => x.id === task.parent_id) : null;
  const who = (pid: number | null) => people.find((p) => p.id === pid)?.name ?? "";
  const doneChecks = check.filter((c) => c.done === 1).length;
  const progress = task.progress ?? (check.length ? Math.round((doneChecks / check.length) * 100) : isPhase ? (children.length ? Math.round((children.filter((x) => x.status === "completed").length / children.length) * 100) : 0) : task.status === "completed" ? 100 : 0);
  const waits = deps.filter((d) => d.task_id === task.id).map((d) => tasks.find((x) => x.id === d.depends_on_id)).filter((x): x is Task => Boolean(x));
  const unlocks = deps.filter((d) => d.depends_on_id === task.id).map((d) => tasks.find((x) => x.id === d.task_id)).filter((x): x is Task => Boolean(x));
  const days = task.start_date && task.end_date ? spanDays(task.start_date, task.end_date) : null;

  const fact = (label: string, value: React.ReactNode) => (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
  const heading = (text: string) => <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{text}</h3>;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5" style={{ boxShadow: `inset 0 4px 0 ${color}` }}>
          <div className="flex items-start gap-3 pr-8">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
              {task.kind === "phase" ? <ListChecks className="size-5" /> : task.status === "completed" ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display text-2xl leading-tight tracking-wide">{task.title}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                <span>{isPhase ? t("wbs.phase") : task.kind === "break" ? t("sch.kind.break") : t("sch.kind.task")}</span>
                {phase ? <span>· {phase.title}</span> : null}
              </DialogDescription>
            </div>
            {!viewer ? (
              <Button size="sm" onClick={() => onEdit(task.id)}>
                <Pencil className="size-4" />
                {t("sch.modify")}
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        <div className="space-y-6 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {fact(t("project.status"), <StatusBadge value={task.status} />)}
            {fact(t("sch.priority"), t(`sch.priority.${task.priority}` as MessageKey))}
            {fact(
              t("wbs.col.progress"),
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-20 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
                  <span className="block h-full rounded-full" style={{ width: `${progress}%`, background: color }} />
                </span>
                <span className="tabular-nums">{progress}%</span>
              </span>,
            )}
            {fact(
              t("sch.start"),
              task.start_date ? (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 text-muted-foreground" />
                  {formatDate(task.start_date, locale)}
                </span>
              ) : null,
            )}
            {fact(t("sch.end"), task.end_date ? formatDate(task.end_date, locale) : null)}
            {fact(t("wbs.col.duration"), days ? t("sch.daysCount", { n: days }) : null)}
            {fact(
              t("wbs.col.responsible"),
              task.responsible || who(task.assigned_to) ? (
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5 text-muted-foreground" />
                  {task.responsible || who(task.assigned_to)}
                </span>
              ) : null,
            )}
            {!viewer ? fact(t("sch.assignee"), task.assigned_to ? <span className="inline-flex items-center gap-1.5"><UserAvatar name={who(task.assigned_to)} size="sm" />{who(task.assigned_to)}</span> : null) : null}
          </div>

          {task.description ? (
            <section className="space-y-1.5">
              {heading(t("sch.description"))}
              <p className="whitespace-pre-wrap text-sm">{task.description}</p>
            </section>
          ) : null}

          {isPhase ? (
            <section className="space-y-2">
              {heading(t("sch.phaseTasks", { n: children.length }))}
              <ul className="divide-y rounded-xl border">
                {children.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onNavigate(c.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40">
                      {c.status === "completed" ? <CheckCircle2 className="size-4 shrink-0" style={{ color }} /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                      <span className={cn("min-w-0 flex-1 truncate", c.status === "completed" && "text-muted-foreground line-through")}>{c.title}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {c.start_date ? formatDate(c.start_date, locale) : "…"} → {c.end_date ? formatDate(c.end_date, locale) : "…"}
                      </span>
                    </button>
                  </li>
                ))}
                {children.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">—</li> : null}
              </ul>
            </section>
          ) : null}

          {!viewer && (waits.length || unlocks.length) ? (
            <section className="space-y-2">
              {heading(t("sch.relations"))}
              {[
                { label: t("sch.waitsFor"), list: waits },
                { label: t("sch.unlocks"), list: unlocks },
              ]
                .filter((g) => g.list.length)
                .map((g) => (
                  <div key={g.label}>
                    <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" />
                      {g.label}
                    </p>
                    <ul className="space-y-1">
                      {g.list.map((o) => (
                        <li key={o.id}>
                          <button type="button" onClick={() => onNavigate(o.id)} className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-left text-sm hover:bg-muted/50">
                            <span className={cn("size-2 rounded-full", o.status === "completed" ? "bg-emerald-500" : "bg-red-500")} />
                            <span className="min-w-0 flex-1 truncate">{o.title}</span>
                            <span className="text-xs text-muted-foreground">{t(`status.${o.status}` as MessageKey)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </section>
          ) : null}

          {!viewer && check.length ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                {heading(t("sch.checklist"))}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {doneChecks}/{check.length}
                </span>
              </div>
              <ul className="space-y-1">
                {check.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    {c.done === 1 ? <CheckCircle2 className="size-4" style={{ color }} /> : <Circle className="size-4 text-muted-foreground" />}
                    <span className={cn(c.done === 1 && "text-muted-foreground line-through")}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!viewer && notes.length ? (
            <section className="space-y-2">
              {heading(t("sch.notes"))}
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="flex gap-3">
                    <UserAvatar name={who(n.user_id) || "?"} size="sm" />
                    <div className="min-w-0 flex-1 rounded-xl border bg-muted/30 px-3 py-2">
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="size-3" />
                        <span className="font-medium text-foreground">{who(n.user_id) || "—"}</span> · {formatDateTime(n.created_at, locale)}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">{n.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!viewer ? (
            <section className="space-y-2">
              {heading(t("sch.files"))}
              <Attachments projectId={project.id} owner="task" ownerId={task.id} canEdit={false} />
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
