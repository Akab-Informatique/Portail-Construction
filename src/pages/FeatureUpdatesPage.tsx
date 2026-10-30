import { useCallback, useEffect, useMemo, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { Check, ListChecks, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Item = typeof schema.feature_requests.$inferSelect;
type Filter = "open" | "done" | "all";
const PRIORITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** From calm to urgent: 1-3 can wait, 4-6 soon, 7-8 important, 9-10 now. */
function tone(priority: number) {
  if (priority >= 9) return "bg-rose-500/15 text-rose-800 border-rose-500/30 dark:text-rose-300";
  if (priority >= 7) return "bg-orange-500/15 text-orange-800 border-orange-500/30 dark:text-orange-300";
  if (priority >= 4) return "bg-amber-400/20 text-amber-800 border-amber-500/30 dark:text-amber-300";
  return "bg-muted text-muted-foreground border-border";
}

function PriorityPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
      {PRIORITIES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-all",
            value === n ? `${tone(n)} shadow-sm` : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/**
 * The administrators' to-do list for the portal itself: features and changes they want, each with a priority from 1
 * (can wait) to 10 (now). The most urgent come first; ticking one marks it done.
 */
export function FeatureUpdatesPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState(5);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; title: string; notes: string; priority: number } | null>(null);

  const load = useCallback(async () => {
    await dbReady;
    setItems(await db.select().from(schema.feature_requests).orderBy(desc(schema.feature_requests.priority), desc(schema.feature_requests.id)));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const open = (items ?? []).filter((i) => i.done === 0);
  const done = (items ?? []).filter((i) => i.done === 1);
  const shown = useMemo(() => (filter === "open" ? open : filter === "done" ? done : [...open, ...done]), [filter, items]);

  async function add() {
    const text = title.trim();
    if (!text) return;
    setBusy(true);
    try {
      await db.insert(schema.feature_requests).values({ title: text, notes: notes.trim() || null, priority, created_by: user?.id ?? null, created_at: new Date() });
      setTitle("");
      setNotes("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: Item) {
    await db
      .update(schema.feature_requests)
      .set(item.done === 1 ? { done: 0, done_at: null } : { done: 1, done_at: new Date() })
      .where(eq(schema.feature_requests.id, item.id));
    await load();
  }

  async function saveEdit() {
    if (!editing || !editing.title.trim()) return;
    await db
      .update(schema.feature_requests)
      .set({ title: editing.title.trim(), notes: editing.notes.trim() || null, priority: editing.priority })
      .where(eq(schema.feature_requests.id, editing.id));
    setEditing(null);
    await load();
  }

  async function remove(item: Item) {
    if (!window.confirm(t("fu.deleteConfirm"))) return;
    await db.delete(schema.feature_requests).where(eq(schema.feature_requests.id, item.id));
    await load();
  }

  if (items === null) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("nav.setup")} title={t("fu.title")} description={t("fu.subtitle")} />

      <Card className="gap-4 p-5" style={{ boxShadow: "var(--glass-shadow), inset 0 3px 0 #faa32b" }}>
        <div className="space-y-1.5">
          <Label>{t("fu.what")}</Label>
          <Input correct value={title} placeholder={t("fu.whatPh")} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("fu.details")}</Label>
          <Textarea correct rows={2} value={notes} placeholder={t("fu.detailsPh")} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <Label>{t("fu.priority")}</Label>
            <PriorityPicker value={priority} onChange={setPriority} />
            <p className="text-xs text-muted-foreground">{t("fu.priorityHint")}</p>
          </div>
          <Button onClick={() => void add()} disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t("fu.add")}
          </Button>
        </div>
      </Card>

      <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
        {(
          [
            ["open", t("fu.open"), open.length],
            ["done", t("fu.done"), done.length],
            ["all", t("sch.filter.all"), items.length],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", filter === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
            <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-5" />} title={filter === "done" ? t("fu.noneDone") : t("fu.none")} description={filter === "done" ? "" : t("fu.noneHint")} />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <ul className="divide-y">
            {shown.map((item) => {
              const isEditing = editing?.id === item.id;
              return (
                <li key={item.id} className={cn("flex gap-3 px-4 py-3.5", item.done === 1 && "bg-muted/30")}>
                  <Checkbox className="mt-1" checked={item.done === 1} onCheckedChange={() => void toggle(item)} aria-label={t("fu.done")} />
                  {isEditing && editing ? (
                    <div className="min-w-0 flex-1 space-y-3">
                      <Input correct value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                      <Textarea correct rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                      <PriorityPicker value={editing.priority} onChange={(n) => setEditing({ ...editing, priority: n })} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void saveEdit()} disabled={!editing.title.trim()}>
                          <Check className="size-4" />
                          {t("settings.save")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          <X className="size-4" />
                          {t("clients.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold tabular-nums", item.done === 1 ? "border-border bg-muted text-muted-foreground" : tone(item.priority))} title={t("fu.priority")}>
                        {item.priority}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", item.done === 1 && "text-muted-foreground line-through")}>{item.title}</p>
                        {item.notes ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p> : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(item.created_at.toISOString().slice(0, 10), locale)}
                          {item.done === 1 && item.done_at ? ` · ${t("fu.doneOn")} ${formatDate(item.done_at.toISOString().slice(0, 10), locale)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <Button size="icon-sm" variant="ghost" aria-label={t("note.edit")} title={t("note.edit")} onClick={() => setEditing({ id: item.id, title: item.title, notes: item.notes ?? "", priority: item.priority })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={t("exp.delete")} title={t("exp.delete")} onClick={() => void remove(item)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
