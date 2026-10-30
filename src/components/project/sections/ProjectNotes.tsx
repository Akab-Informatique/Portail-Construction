import { useCallback, useEffect, useRef, useState } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { Bot, Camera, Check, MessageSquare, Eye, EyeOff, Loader2, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import { syncAutoNotes } from "@/lib/task-activity";
import { db, schema } from "../../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { addAttachment, countAttachments } from "@/lib/project-files";
import { NOTES_EVENT, deleteProjectNote, notifyNotesChanged, updateProjectNote } from "@/lib/notes-sync";
import { notifyEvent, notifySummary, sendNotification } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { Attachments } from "@/components/project/Attachments";
import { NotifyPicker, type NotifyChoice } from "@/components/project/NotifyPicker";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

type Note = typeof schema.project_notes.$inferSelect;
type Visibility = "everyone" | "internal";
type Comment = typeof schema.note_comments.$inferSelect;

/**
 * Notes: the project's journal. Each note is either for everyone (the client will see it) or internal only,
 * can carry photos, and can tell people right away by email or text message.
 */
export function ProjectNotes({ project, people, members }: SectionProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const color = projectColor(project);
  const [notes, setNotes] = useState<Note[]>([]);
  const [fileCount, setFileCount] = useState<Record<number, number>>({});
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("internal");
  const [pending, setPending] = useState<File[]>([]);
  const [notify, setNotify] = useState<NotifyChoice>({ userIds: [], channels: ["email"] });
  const [filter, setFilter] = useState<"all" | Visibility | "auto">("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const isAdminUser = Boolean(user?.is_admin) && user?.view_as !== "client";
  // A client account reads the notes shared with it and comments on them; it cannot write notes.
  const viewer = user?.user_type === "external" || user?.view_as === "client";
  const [comments, setComments] = useState<Record<number, Comment[]>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [sendingComment, setSendingComment] = useState<number | null>(null);
  /** The note being edited here, with its new text and who it is for. */
  const [editing, setEditing] = useState<{ id: number; body: string; visibility: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    // The portal's own notes about late or stalled tasks, for administrators only.
    if (isAdminUser) await syncAutoNotes(project, t as never, locale).catch(() => 0);
    const [rows, counts, commentRows] = await Promise.all([
      db.select().from(schema.project_notes).where(eq(schema.project_notes.project_id, project.id)).orderBy(desc(schema.project_notes.created_at), desc(schema.project_notes.id)),
      countAttachments(project.id, "note"),
      db.select().from(schema.note_comments).where(eq(schema.note_comments.project_id, project.id)).orderBy(asc(schema.note_comments.id)),
    ]);
    setNotes(rows);
    setFileCount(counts);
    const grouped: Record<number, Comment[]> = {};
    for (const c of commentRows) (grouped[c.note_id] ??= []).push(c);
    setComments(grouped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, isAdminUser]);
  useEffect(() => {
    void load();
    // an edit or a deletion made from the notebook (or another tab of the project) shows here at once
    const on = () => void load();
    window.addEventListener(NOTES_EVENT, on);
    return () => window.removeEventListener(NOTES_EVENT, on);
  }, [load]);

  const staff = people.filter((p) => p.user_type === "internal");
  const inCharge = members.map((m) => m.user_id);
  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "—";
  const isAdmin = Boolean(user?.is_admin);

  async function comment(note: Note) {
    const text = (drafts[note.id] ?? "").trim();
    if (!text || !user) return;
    setSendingComment(note.id);
    try {
      const [row] = await db.insert(schema.note_comments).values({ note_id: note.id, project_id: project.id, user_id: user.id, body: text, created_on: new Date().toISOString() }).returning();
      setDrafts((d) => ({ ...d, [note.id]: "" }));
      await load();
      // the person who wrote the note hears about it
      if (row) void notifyEvent("note_comment", row.id);
    } finally {
      setSendingComment(null);
    }
  }

  async function post() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setMessage(null);
    try {
      const [row] = await db.insert(schema.project_notes).values({ project_id: project.id, user_id: user?.id ?? null, body: text, visibility, created_at: new Date() }).returning();
      for (const file of pending) await addAttachment(file, { projectId: project.id, owner: "note", ownerId: row.id, userId: user?.id ?? null }).catch(() => undefined);
      await logActivity({ action: "added note", details: text.slice(0, 80), projectId: project.id, userId: user?.id });
      if (notify.userIds.length && notify.channels.length) {
        const result = await sendNotification({
          userIds: notify.userIds,
          channels: notify.channels,
          subject: `${project.project_number} · ${project.name}`,
          text: `${user?.name ?? ""}:\n${text.slice(0, 500)}\n\n${window.location.origin}/projects/${project.id}/notes`,
        });
        setMessage(notifySummary(result, t as never));
      }
      setBody("");
      setPending([]);
      await load();
      notifyNotesChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing || !editing.body.trim()) return;
    setSaving(true);
    try {
      await updateProjectNote(editing.id, { body: editing.body.trim(), visibility: editing.visibility });
      await logActivity({ action: "edited note", details: editing.body.trim().slice(0, 80), projectId: project.id, userId: user?.id });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  // Notes written by the portal are for administrators only, for now.
  const visible = notes.filter((n) => n.dismissed !== 1).filter((n) => (viewer ? n.visibility === "everyone" && n.auto === 0 : n.visibility !== "admin" || isAdminUser));
  const shown = visible.filter((n) => (filter === "auto" ? n.auto === 1 : filter === "all" || n.visibility === filter));

  return (
    <div className={cn("grid gap-5", !viewer && "lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]")}>
      {/* composer */}
      {viewer ? null : (
      <Card className="h-fit gap-4 p-5 lg:sticky lg:top-36">
        <Textarea rows={5} value={body} placeholder={t("note.placeholder")} onChange={(e) => setBody(e.target.value)} />

        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 max-w-full overflow-x-auto">
          {(["internal", "everyone"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={visibility === v}
              onClick={() => setVisibility(v)}
              className={cn("flex h-9 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all", visibility === v ? "text-foreground shadow-sm" : "text-muted-foreground")}
              style={visibility === v ? { background: `color-mix(in srgb, ${color} 20%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)` } : undefined}
            >
              {v === "internal" ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {t(`note.vis.${v}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => pick.current?.click()}>
            <Paperclip className="size-4" />
            {t("att.add")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => camera.current?.click()}>
            <Camera className="size-4" />
            {t("att.photo")}
          </Button>
          <input ref={pick} type="file" multiple className="sr-only" onChange={(e) => { setPending((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setPending((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
        {pending.length ? (
          <ul className="flex flex-wrap gap-2">
            {pending.map((f, i) => (
              <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-1 pr-1 pl-3 text-xs">
                <span className="truncate">{f.name}</span>
                <button type="button" aria-label={t("exp.delete")} className="rounded-full p-0.5 hover:bg-foreground/10" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <NotifyPicker people={staff} value={notify} onChange={setNotify} preselect={inCharge} />

        <Button onClick={() => void post()} disabled={busy || !body.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("note.post")}
        </Button>
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      </Card>
      )}

      {/* journal */}
      <div className="space-y-3">
        <div className={cn("flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5 max-w-full overflow-x-auto self-start w-fit", viewer && "hidden")}>
          {(isAdminUser ? (["all", "everyone", "internal", "auto"] as const) : (["all", "everyone", "internal"] as const)).map((f) => (
            <Button key={f} type="button" size="sm" variant={filter === f ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setFilter(f)}>
              {f === "all" ? t("sch.filter.all") : f === "auto" ? t("note.filter.auto") : t(`note.vis.${f}`)}
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">{t("note.empty")}</Card>
        ) : (
          <ul className="space-y-3">
            {shown.map((n) => {
              const mine = n.user_id === user?.id;
              return (
                <li key={n.id}>
                  <Card className="gap-3 p-4" style={{ boxShadow: `var(--glass-shadow), inset 3px 0 0 ${n.visibility === "everyone" ? color : "transparent"}` }}>
                    <div className="flex items-center gap-3">
                      {n.auto === 1 ? (
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                          <Bot className="size-4" />
                        </span>
                      ) : (
                        <UserAvatar name={who(n.user_id)} size="sm" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{n.auto === 1 ? t("note.autoAuthor") : who(n.user_id)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(n.created_at, locale)}
                          {n.updated_at ? ` · ${t("note.edited")} ${formatDateTime(n.updated_at, locale)}` : ""}
                        </p>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", n.visibility === "everyone" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : n.visibility === "admin" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
                        {n.visibility === "everyone" ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                        {n.visibility === "admin" ? t("note.vis.admin") : t(`note.vis.${n.visibility === "everyone" ? "everyone" : "internal"}`)}
                      </span>
                      {!viewer && (mine || isAdmin) && n.auto === 0 ? (
                        <Button size="icon-sm" variant="ghost" aria-label={t("note.edit")} title={t("note.edit")} onClick={() => setEditing({ id: n.id, body: n.body, visibility: n.visibility })}>
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {!viewer && (mine || isAdmin) ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("exp.delete")}
                          onClick={async () => {
                            if (!window.confirm(t("note.deleteConfirm"))) return;
                            await deleteProjectNote({ id: n.id, project_id: project.id, auto: n.auto });
                            await load();
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    {editing?.id === n.id ? (
                      <div className="space-y-2">
                        <Textarea rows={5} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                        <div className="flex flex-wrap items-center gap-2">
                          {n.visibility !== "admin" ? (
                            <div className="flex gap-1 rounded-lg border bg-muted/40 p-0.5">
                              {(["internal", "everyone"] as const).map((v) => (
                                <Button key={v} type="button" size="sm" variant={editing.visibility === v ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setEditing({ ...editing, visibility: v })}>
                                  {t(`note.vis.${v}`)}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                          <Button type="button" size="sm" onClick={() => void saveEdit()} disabled={saving || !editing.body.trim()}>
                            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                            {t("settings.save")}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            {t("clients.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
                    )}
                    {fileCount[n.id] ? <Attachments projectId={project.id} owner="note" ownerId={n.id} canEdit={!viewer && (mine || isAdmin)} onChange={() => void load()} /> : null}
                    <div className="space-y-2 border-t pt-3">
                      {(comments[n.id] ?? []).map((c) => (
                        <div key={c.id} className="flex gap-2.5">
                          <UserAvatar name={who(c.user_id)} size="sm" />
                          <div className="min-w-0 flex-1 rounded-xl bg-muted/40 px-3 py-2">
                            <p className="text-xs"><span className="font-medium">{who(c.user_id)}</span> <span className="text-muted-foreground">· {formatDateTime(c.created_on, locale)}</span></p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-end gap-2">
                        <Textarea rows={1} className="min-h-10" value={drafts[n.id] ?? ""} placeholder={t("note.commentPh")} onChange={(e) => setDrafts((d) => ({ ...d, [n.id]: e.target.value }))} />
                        <Button type="button" size="sm" variant="outline" disabled={sendingComment === n.id || !(drafts[n.id] ?? "").trim()} onClick={() => void comment(n)}>
                          {sendingComment === n.id ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
                          {t("note.comment")}
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
