import { useCallback, useEffect, useState } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { Plus, Trash2 } from "lucide-react";
import { db, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { formatDateTime } from "@/lib/format";
import { PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { projectColor } from "@/lib/project-colors";
import { removeAttachmentsOf } from "@/lib/project-files";
import type { Project, User } from "@/lib/types";
import { Attachments } from "@/components/project/Attachments";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type Task = typeof schema.project_tasks.$inferSelect;
type CheckItem = typeof schema.task_checklist.$inferSelect;
type TaskNote = typeof schema.task_notes.$inferSelect;

/** Everything about one task: its fields, a checklist, a thread of notes and its files. */
export function TaskDrawer({
  project,
  task,
  people,
  open,
  onClose,
  onChanged,
}: {
  project: Project;
  task: Task | null;
  people: User[];
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const color = projectColor(project);
  const [check, setCheck] = useState<CheckItem[]>([]);
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [newItem, setNewItem] = useState("");
  const [newNote, setNewNote] = useState("");
  const taskId = task?.id ?? 0;

  const load = useCallback(async () => {
    if (!taskId) return;
    const [c, n] = await Promise.all([
      db.select().from(schema.task_checklist).where(eq(schema.task_checklist.task_id, taskId)).orderBy(asc(schema.task_checklist.sort_order), asc(schema.task_checklist.id)),
      db.select().from(schema.task_notes).where(eq(schema.task_notes.task_id, taskId)).orderBy(desc(schema.task_notes.id)),
    ]);
    setCheck(c);
    setNotes(n);
  }, [taskId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!task) return null;
  const done = check.filter((c) => c.done === 1).length;
  const pct = check.length ? Math.round((done / check.length) * 100) : 0;

  async function patch(values: Partial<Task>) {
    if (!task) return;
    await db.update(schema.project_tasks).set(values).where(eq(schema.project_tasks.id, task.id));
    onChanged();
  }

  async function addItem() {
    const label = newItem.trim();
    if (!label || !task) return;
    await db.insert(schema.task_checklist).values({ project_id: project.id, task_id: task.id, label, done: 0, sort_order: check.length });
    setNewItem("");
    await load();
    onChanged();
  }

  async function addNote() {
    const body = newNote.trim();
    if (!body || !task) return;
    await db.insert(schema.task_notes).values({ project_id: project.id, task_id: task.id, user_id: user?.id ?? null, body });
    setNewNote("");
    await load();
    onChanged();
  }

  async function remove() {
    if (!task || !window.confirm(t("sch.deleteConfirm"))) return;
    await db.delete(schema.task_checklist).where(eq(schema.task_checklist.task_id, task.id));
    await db.delete(schema.task_notes).where(eq(schema.task_notes.task_id, task.id));
    await removeAttachmentsOf(project.id, "task", task.id);
    await db.delete(schema.project_tasks).where(eq(schema.project_tasks.id, task.id));
    onClose();
    onChanged();
  }

  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "—";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <Input
            key={`t-${task.id}`}
            defaultValue={task.title}
            className="h-auto border-0 bg-transparent px-0 font-display text-2xl tracking-wide shadow-none focus-visible:ring-0"
            onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && void patch({ title: e.target.value.trim() })}
          />
        </SheetHeader>

        <div className="space-y-7 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("project.status")}</Label>
              <Select value={task.status} onValueChange={(v) => void patch({ status: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{t(`status.${s.value}` as MessageKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.priority")}</Label>
              <Select value={task.priority} onValueChange={(v) => void patch({ priority: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{t(`sch.priority.${p.value}` as MessageKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.start")}</Label>
              <Input type="date" defaultValue={task.start_date ?? ""} key={`s-${task.id}-${task.start_date}`} onBlur={(e) => e.target.value !== (task.start_date ?? "") && void patch({ start_date: e.target.value || null })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sch.end")}</Label>
              <Input type="date" defaultValue={task.end_date ?? ""} key={`e-${task.id}-${task.end_date}`} onBlur={(e) => e.target.value !== (task.end_date ?? "") && void patch({ end_date: e.target.value || null })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("sch.assignee")}</Label>
              <Select value={task.assigned_to ? String(task.assigned_to) : "none"} onValueChange={(v) => void patch({ assigned_to: v === "none" ? null : Number(v) })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("sch.unassigned")}</SelectItem>
                  {people.filter((p) => p.user_type === "internal").map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("sch.description")}</Label>
            <Textarea
              key={`d-${task.id}`}
              rows={3}
              defaultValue={task.description ?? ""}
              onBlur={(e) => e.target.value !== (task.description ?? "") && void patch({ description: e.target.value.trim() || null })}
            />
          </div>

          {/* checklist */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("sch.checklist")}</h3>
              {check.length ? <span className="text-xs tabular-nums text-muted-foreground">{done}/{check.length}</span> : null}
            </div>
            {check.length ? (
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
            ) : null}
            <ul className="space-y-1">
              {check.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50">
                  <Checkbox
                    checked={c.done === 1}
                    onCheckedChange={async (v) => {
                      await db.update(schema.task_checklist).set({ done: v === true ? 1 : 0 }).where(eq(schema.task_checklist.id, c.id));
                      await load();
                      onChanged();
                    }}
                  />
                  <span className={c.done === 1 ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm"}>{c.label}</span>
                  <button
                    type="button"
                    aria-label={t("exp.delete")}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={async () => {
                      await db.delete(schema.task_checklist).where(eq(schema.task_checklist.id, c.id));
                      await load();
                      onChanged();
                    }}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input value={newItem} placeholder={t("sch.addItem")} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addItem()} />
              <Button type="button" variant="outline" size="icon" onClick={() => void addItem()} aria-label={t("sch.addItem")}>
                <Plus className="size-4" />
              </Button>
            </div>
          </section>

          {/* notes */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("sch.notes")}</h3>
            <div className="space-y-2">
              <Textarea rows={2} value={newNote} placeholder={t("sch.notePlaceholder")} onChange={(e) => setNewNote(e.target.value)} />
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={!newNote.trim()} onClick={() => void addNote()}>
                  {t("sch.addNote")}
                </Button>
              </div>
            </div>
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="flex gap-3">
                  <UserAvatar name={who(n.user_id)} size="sm" />
                  <div className="min-w-0 flex-1 rounded-xl border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{who(n.user_id)}</span> · {formatDateTime(n.created_at, locale)}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* files */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("sch.files")}</h3>
            <Attachments projectId={project.id} owner="task" ownerId={task.id} onChange={onChanged} />
          </section>

          <div className="flex justify-end border-t pt-4">
            <Button type="button" variant="outline" onClick={() => void remove()}>
              <Trash2 className="size-4" />
              {t("sch.delete")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
