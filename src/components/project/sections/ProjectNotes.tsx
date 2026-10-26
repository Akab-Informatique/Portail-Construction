import { useCallback, useEffect, useRef, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { Camera, Eye, EyeOff, Loader2, Paperclip, Send, Trash2, X } from "lucide-react";
import { db, schema } from "../../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { addAttachment, countAttachments, removeAttachmentsOf } from "@/lib/project-files";
import { notifySummary, sendNotification } from "@/lib/notify";
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
  const [filter, setFilter] = useState<"all" | Visibility>("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [rows, counts] = await Promise.all([
      db.select().from(schema.project_notes).where(eq(schema.project_notes.project_id, project.id)).orderBy(desc(schema.project_notes.created_at), desc(schema.project_notes.id)),
      countAttachments(project.id, "note"),
    ]);
    setNotes(rows);
    setFileCount(counts);
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const staff = people.filter((p) => p.user_type === "internal");
  const inCharge = members.map((m) => m.user_id);
  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "—";
  const isAdmin = Boolean(user?.is_admin);

  async function post() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setMessage(null);
    try {
      const [row] = await db.insert(schema.project_notes).values({ project_id: project.id, user_id: user?.id ?? null, body: text, visibility }).returning();
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
    } finally {
      setBusy(false);
    }
  }

  const shown = notes.filter((n) => filter === "all" || n.visibility === filter);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* composer */}
      <Card className="h-fit gap-4 p-5 lg:sticky lg:top-36">
        <Textarea rows={5} value={body} placeholder={t("note.placeholder")} onChange={(e) => setBody(e.target.value)} />

        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1">
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

      {/* journal */}
      <div className="space-y-3">
        <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5 self-start w-fit">
          {(["all", "everyone", "internal"] as const).map((f) => (
            <Button key={f} type="button" size="sm" variant={filter === f ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setFilter(f)}>
              {f === "all" ? t("sch.filter.all") : t(`note.vis.${f}`)}
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
                      <UserAvatar name={who(n.user_id)} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{who(n.user_id)}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at, locale)}</p>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", n.visibility === "everyone" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                        {n.visibility === "everyone" ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                        {t(`note.vis.${n.visibility === "everyone" ? "everyone" : "internal"}`)}
                      </span>
                      {mine || isAdmin ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("exp.delete")}
                          onClick={async () => {
                            if (!window.confirm(t("note.deleteConfirm"))) return;
                            await removeAttachmentsOf(project.id, "note", n.id);
                            await db.delete(schema.project_notes).where(eq(schema.project_notes.id, n.id));
                            await load();
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
                    {fileCount[n.id] ? <Attachments projectId={project.id} owner="note" ownerId={n.id} canEdit={mine || isAdmin} onChange={() => void load()} /> : null}
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
