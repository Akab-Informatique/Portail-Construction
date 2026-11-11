import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { desc, eq } from "drizzle-orm";
import { BookOpen, Check, CheckCircle2, ImagePlus, ListChecks, Loader2, MessageSquare, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useDraft, useDraftMap } from "@/lib/use-draft";
import { formatDate } from "@/lib/format";
import { sendNotification } from "@/lib/notify";
import { imageToJpeg, listSops } from "@/lib/sop";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
type Comment = typeof schema.feature_comments.$inferSelect;
type Filter = "open" | "review" | "done" | "all";
const PRIORITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** From calm to urgent: 1-3 can wait, 4-6 soon, 7-8 important, 9-10 now. */
function tone(priority: number) {
  if (priority >= 9) return "bg-rose-500/15 text-rose-800 border-rose-500/30 dark:text-rose-300";
  if (priority >= 7) return "bg-orange-500/15 text-orange-800 border-orange-500/30 dark:text-orange-300";
  if (priority >= 4) return "bg-amber-400/20 text-amber-800 border-amber-500/30 dark:text-amber-300";
  return "bg-muted text-muted-foreground border-border";
}

const imagesOf = (json: string | null): string[] => {
  try {
    return json ? (JSON.parse(json) as string[]) : [];
  } catch {
    return [];
  }
};

type SopOption = { id: number; title: string };

/** Pictures (picked, dropped or pasted) and a link to one of the binder's SOP, for a request. */
function Extras({ images, onImages, sopId, onSop, sops, onOpen }: { images: string[]; onImages: (v: string[]) => void; sopId: number | null; onSop: (v: number | null) => void; sops: SopOption[]; onOpen: (src: string) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    const made: string[] = [];
    for (const f of files.filter((x) => x.type.startsWith("image/"))) made.push(await imageToJpeg(f, 1200));
    if (made.length) onImages([...images, ...made]);
  };
  return (
    <div
      className="space-y-3"
      onPaste={(e) => {
        const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          void add(files);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" />
          {t("fu.addPictures")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("fu.pasteHint")}</span>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <button type="button" onClick={() => onOpen(src)}>
                <img src={src} alt="" className="h-20 w-28 rounded-md border object-cover" />
              </button>
              <button type="button" aria-label={t("exp.delete")} onClick={() => onImages(images.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-card shadow-sm">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="size-4 text-muted-foreground" />
        <select value={sopId ?? ""} onChange={(e) => onSop(e.target.value ? Number(e.target.value) : null)} className="h-9 min-w-52 max-w-full rounded-md border bg-background px-2 text-sm" aria-label={t("fu.linkSop")}>
          <option value="">{t("fu.linkSop")}</option>
          {sops.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
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
  const [title, setTitle] = useDraft(`fu:title:${user?.id ?? 0}`);
  const [notes, setNotes] = useDraft(`fu:notes:${user?.id ?? 0}`);
  const [priority, setPriority] = useState(5);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; title: string; notes: string; priority: number; images: string[]; sop_id: number | null } | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [sopId, setSopId] = useState<number | null>(null);
  const [sops, setSops] = useState<SopOption[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [comments, setComments] = useState<Comment[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [openThread, setOpenThread] = useState<number | null>(null);
  const [threadDrafts, setThreadDrafts] = useDraftMap(`fu:comment:${user?.id ?? 0}`);
  const draft = openThread ? threadDrafts(openThread) : "";
  const setDraft = (v: string) => { if (openThread) setThreadDrafts(openThread, v); };
  const [closing, setClosing] = useState<Item | null>(null);
  const [closingNote, setClosingNote] = useState("");
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const load = useCallback(async () => {
    await dbReady;
    setItems(await db.select().from(schema.feature_requests).orderBy(desc(schema.feature_requests.priority), desc(schema.feature_requests.id)));
    setSops((await listSops().catch(() => [])).map((x) => ({ id: x.id, title: x.title })));
    setComments(await db.select().from(schema.feature_comments).orderBy(schema.feature_comments.id).catch(() => []));
    const us = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).catch(() => []);
    setNames(Object.fromEntries(us.map((u) => [u.id, u.name])));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // "Send as a portal request" from a SOP: the form opens already filled with its name and link; priority is up to the person.
  useEffect(() => {
    const from = (location.state as { fromSop?: { id: number; title: string; description: string } } | null)?.fromSop;
    if (!from) return;
    setTitle(from.title);
    setNotes(from.description);
    setSopId(from.id);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const open = (items ?? []).filter((i) => i.status === "open");
  const review = (items ?? []).filter((i) => i.status === "review");
  const done = (items ?? []).filter((i) => i.status === "done");
  const shown = useMemo(() => (filter === "open" ? open : filter === "review" ? review : filter === "done" ? done : [...open, ...review, ...done]), [filter, items]);
  const nameOf = (id: number | null) => (id ? (names[id] ?? "?") : "?");
  const threadOf = (id: number) => comments.filter((c) => c.request_id === id);

  /** Tells the people around an item (who asked, who closed, who commented) by email, except the one acting. */
  async function tell(item: Item, subject: string, text: string, extra: (number | null)[] = []) {
    const ids = new Set<number>();
    for (const id of [item.created_by, item.closed_by, ...threadOf(item.id).map((c) => c.user_id), ...extra]) if (id && id !== user?.id) ids.add(id);
    if (ids.size === 0) return;
    void sendNotification({ userIds: [...ids], channels: ["email"], subject: `${subject} · ${item.title}`, text: `${text}\n\n${window.location.origin}/updates` });
  }

  async function add() {
    const text = title.trim();
    if (!text) return;
    setBusy(true);
    try {
      await db.insert(schema.feature_requests).values({ title: text, notes: notes.trim() || null, priority, created_by: user?.id ?? null, created_at: new Date(), images: images.length ? JSON.stringify(images) : null, sop_id: sopId });
      setTitle("");
      setNotes("");
      setImages([]);
      setSopId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /** Ticking an open item asks for the final note; ticking one back reopens it. */
  async function toggle(item: Item) {
    if (item.status === "open") {
      setClosing(item);
      setClosingNote("");
      return;
    }
    await db.update(schema.feature_requests).set({ status: "open", done: 0, done_at: null }).where(eq(schema.feature_requests.id, item.id));
    await load();
  }

  /** The administrator closes it with a note on what was done: it waits for the requester to confirm. */
  async function confirmClose() {
    if (!closing || !closingNote.trim()) return;
    const note = closingNote.trim();
    await db.update(schema.feature_requests).set({ status: "review", done: 0, done_at: new Date(), final_note: note, closed_by: user?.id ?? null }).where(eq(schema.feature_requests.id, closing.id));
    await db.insert(schema.feature_comments).values({ request_id: closing.id, user_id: user?.id ?? null, body: note, kind: "final", created_at: new Date() });
    await tell(closing, t("fu.mail.review"), `${t("fu.mail.reviewBody", { name: user?.name ?? "" })}\n\n${note}`);
    setClosing(null);
    await load();
  }

  /** The requester confirms that everything is good: the item is closed for good. */
  async function validate(item: Item) {
    await db.update(schema.feature_requests).set({ status: "done", done: 1, done_at: new Date() }).where(eq(schema.feature_requests.id, item.id));
    await tell(item, t("fu.mail.validated"), t("fu.mail.validatedBody", { name: user?.name ?? "" }));
    await load();
  }

  /** Not good: the reason goes in as a comment and the item goes back to the ones still to do. */
  async function reject() {
    if (!rejecting || !rejectNote.trim()) return;
    const note = rejectNote.trim();
    await db.insert(schema.feature_comments).values({ request_id: rejecting.id, user_id: user?.id ?? null, body: note, kind: "rejected", created_at: new Date() });
    await db.update(schema.feature_requests).set({ status: "open", done: 0, done_at: null }).where(eq(schema.feature_requests.id, rejecting.id));
    await tell(rejecting, t("fu.mail.rejected"), `${t("fu.mail.rejectedBody", { name: user?.name ?? "" })}\n\n${note}`);
    setRejecting(null);
    setRejectNote("");
    await load();
  }

  async function postComment(item: Item) {
    const body = draft.trim();
    if (!body) return;
    await db.insert(schema.feature_comments).values({ request_id: item.id, user_id: user?.id ?? null, body, kind: "comment", created_at: new Date() });
    await tell(item, t("fu.mail.comment"), `${user?.name ?? ""}:\n\n${body}`);
    setDraft("");
    await load();
  }

  async function saveEdit() {
    if (!editing || !editing.title.trim()) return;
    await db
      .update(schema.feature_requests)
      .set({ title: editing.title.trim(), notes: editing.notes.trim() || null, priority: editing.priority, images: editing.images.length ? JSON.stringify(editing.images) : null, sop_id: editing.sop_id })
      .where(eq(schema.feature_requests.id, editing.id));
    setEditing(null);
    await load();
  }

  async function remove(item: Item) {
    if (!window.confirm(t("fu.deleteConfirm"))) return;
    await db.delete(schema.feature_comments).where(eq(schema.feature_comments.request_id, item.id));
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
        <Extras images={images} onImages={setImages} sopId={sopId} onSop={setSopId} sops={sops} onOpen={setZoom} />
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
            ["review", t("fu.review"), review.length],
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
                <li key={item.id} className={cn("px-4 py-3.5", item.status === "done" && "bg-muted/30", item.status === "review" && "bg-amber-400/10")}>
                  <div className="flex gap-3">
                  <Checkbox className="mt-1" checked={item.status !== "open"} onCheckedChange={() => void toggle(item)} aria-label={t("fu.done")} />
                  {isEditing && editing ? (
                    <div className="min-w-0 flex-1 space-y-3">
                      <Input correct value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                      <Textarea correct rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                      <Extras images={editing.images} onImages={(v) => setEditing({ ...editing, images: v })} sopId={editing.sop_id} onSop={(v) => setEditing({ ...editing, sop_id: v })} sops={sops} onOpen={setZoom} />
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
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold tabular-nums", item.status === "done" ? "border-border bg-muted text-muted-foreground" : tone(item.priority))} title={t("fu.priority")}>
                        {item.priority}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", item.status === "done" && "text-muted-foreground line-through")}>{item.title}</p>
                        {item.notes ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p> : null}
                        {imagesOf(item.images).length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {imagesOf(item.images).map((src, i) => (
                              <button key={i} type="button" onClick={() => setZoom(src)}>
                                <img src={src} alt="" className="h-16 w-24 rounded-md border object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {item.sop_id ? (
                          <button type="button" onClick={() => navigate(`/sops/${item.sop_id}`)} className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-muted">
                            <BookOpen className="size-3.5" />
                            {t("fu.sopLink")} · {sops.find((x) => x.id === item.sop_id)?.title ?? "SOP"}
                          </button>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(item.created_at.toISOString().slice(0, 10), locale)}
                          {item.created_by ? ` · ${t("fu.askedBy")} ${nameOf(item.created_by)}` : ""}
                          {item.status !== "open" && item.done_at ? ` · ${t("fu.doneOn")} ${formatDate(item.done_at.toISOString().slice(0, 10), locale)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <Button size="icon-sm" variant="ghost" aria-label={t("fu.comments")} title={t("fu.comments")} onClick={() => { setOpenThread(openThread === item.id ? null : item.id); }}>
                          <MessageSquare className="size-4" />
                          {threadOf(item.id).length ? <span className="text-xs tabular-nums">{threadOf(item.id).length}</span> : null}
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={t("note.edit")} title={t("note.edit")} onClick={() => setEditing({ id: item.id, title: item.title, notes: item.notes ?? "", priority: item.priority, images: imagesOf(item.images), sop_id: item.sop_id })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={t("exp.delete")} title={t("exp.delete")} onClick={() => void remove(item)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </>
                  )}
                  </div>
                  {item.status === "review" && !isEditing ? (
                    <div className="ml-8 mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-400/10 p-3 text-sm">
                      <p className="font-medium">{t("fu.awaiting", { name: nameOf(item.created_by) })}</p>
                      {item.final_note ? <p className="whitespace-pre-wrap text-muted-foreground">{item.final_note}</p> : null}
                      {!item.created_by || item.created_by === user?.id ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void validate(item)}>
                            <CheckCircle2 className="size-4" />
                            {t("fu.yes")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setRejecting(item); setRejectNote(""); }}>
                            <X className="size-4" />
                            {t("fu.no")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {openThread === item.id ? (
                    <div className="ml-8 mt-3 space-y-2">
                      {threadOf(item.id).map((c) => (
                        <div key={c.id} className={cn("rounded-lg border px-3 py-2 text-sm", c.kind === "rejected" && "border-rose-500/40 bg-rose-500/5", c.kind === "final" && "border-amber-500/40 bg-amber-400/10")}>
                          <p className="text-xs text-muted-foreground">
                            {nameOf(c.user_id)} · {formatDate(c.created_at.toISOString().slice(0, 10), locale)}
                            {c.kind === "final" ? ` · ${t("fu.finalNote")}` : c.kind === "rejected" ? ` · ${t("fu.notGood")}` : ""}
                          </p>
                          <p className="whitespace-pre-wrap">{c.body}</p>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Textarea correct rows={2} value={draft} placeholder={t("fu.commentPh")} onChange={(e) => setDraft(e.target.value)} />
                        <Button size="icon" aria-label={t("fu.send")} title={t("fu.send")} disabled={!draft.trim()} onClick={() => void postComment(item)}>
                          <Send className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t("fu.title")}</DialogTitle>
          </DialogHeader>
          {zoom ? <img src={zoom} alt="" className="max-h-[75vh] w-full object-contain" /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("fu.closeTitle")}</DialogTitle>
            <DialogDescription>{closing?.title}</DialogDescription>
          </DialogHeader>
          <Label>{t("fu.finalNote")}</Label>
          <Textarea correct autoFocus rows={5} value={closingNote} placeholder={t("fu.finalNotePh")} onChange={(e) => setClosingNote(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t("fu.closeHint")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>{t("clients.cancel")}</Button>
            <Button disabled={!closingNote.trim()} onClick={() => void confirmClose()}>{t("fu.closeConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("fu.rejectTitle")}</DialogTitle>
            <DialogDescription>{rejecting?.title}</DialogDescription>
          </DialogHeader>
          <Textarea correct autoFocus rows={5} value={rejectNote} placeholder={t("fu.rejectPh")} onChange={(e) => setRejectNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>{t("clients.cancel")}</Button>
            <Button disabled={!rejectNote.trim()} onClick={() => void reject()}>{t("fu.rejectConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
