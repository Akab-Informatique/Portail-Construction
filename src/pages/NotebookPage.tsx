import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { and, desc, eq } from "drizzle-orm";
import { Check, Loader2, Lock, NotebookPen, Plus, Search, Send, Trash2, Undo2 } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { useWorkspace } from "@/lib/workspace";
import { formatDateTime } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { copyAttachments, removeAttachmentsOf } from "@/lib/project-files";
import { Attachments } from "@/components/project/Attachments";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Note = typeof schema.personal_notes.$inferSelect;
type Visibility = "internal" | "everyone" | "admin";
type Draft = { title: string; body: string; project_id: string };
const VISIBILITIES: Visibility[] = ["internal", "everyone", "admin"];
/** The notebook's own files hang on the note and belong to no project. */
const NO_PROJECT = 0;
const SAVE_DELAY = 700;

const stamp = () => new Date().toISOString();
const projectNoteText = (n: { title: string; body: string }) => [n.title.trim(), n.body.trim()].filter(Boolean).join("\n\n");
const draftValues = (d: Draft) => ({ title: d.title, body: d.body, project_id: d.project_id === "none" ? null : Number(d.project_id), updated_on: stamp() });

/**
 * Each employee's private notebook: notes with photos and files, optionally tied to a project. A note tied to a
 * project can be sent to that project's notes and shown there as internal, site (visible to the client) or admin only.
 */
export function NotebookPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { projects } = useWorkspace();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>({ title: "", body: "", project_id: "none" });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [visibility, setVisibility] = useState<Visibility>("internal");
  const [sending, setSending] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(draft);
  latest.current = draft;

  const load = useCallback(async () => {
    await dbReady;
    if (!user) return;
    const rows = await db.select().from(schema.personal_notes).where(eq(schema.personal_notes.user_id, user.id)).orderBy(desc(schema.personal_notes.updated_on), desc(schema.personal_notes.id));
    setNotes(rows);
    return rows;
  }, [user]);

  useEffect(() => {
    void load().then((rows) => rows?.length && setSelected((cur) => cur ?? rows[0].id));
  }, [load]);

  const note = notes.find((n) => n.id === selected) ?? null;
  const projectOf = (id: number | null) => projects.find((p) => p.id === id);

  // open a note: load it into the editor
  useEffect(() => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    setState("idle");
    const opened = notes.find((n) => n.id === selected);
    if (opened) {
      setDraft({ title: opened.title, body: opened.body, project_id: opened.project_id ? String(opened.project_id) : "none" });
      setVisibility((opened.shared_visibility as Visibility) || "internal");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const save = useCallback(
    async (id: number, value: Draft) => {
      setState("saving");
      await db.update(schema.personal_notes).set(draftValues(value)).where(eq(schema.personal_notes.id, id));
      dirty.current = false;
      setState("saved");
      await load();
    },
    [load],
  );

  const change = (patch: Partial<Draft>) => {
    if (!selected) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    dirty.current = true;
    setState("saving");
    window.clearTimeout(timer.current);
    const id = selected;
    timer.current = window.setTimeout(() => void save(id, next), SAVE_DELAY);
  };

  // switching notes or leaving the page must not lose the last keystrokes
  useEffect(() => {
    const id = selected;
    return () => {
      if (dirty.current && id) {
        window.clearTimeout(timer.current);
        void db.update(schema.personal_notes).set(draftValues(latest.current)).where(eq(schema.personal_notes.id, id));
      }
    };
  }, [selected]);

  async function create() {
    if (!user) return;
    const [row] = await db.insert(schema.personal_notes).values({ user_id: user.id, title: "", body: "", created_on: stamp(), updated_on: stamp() }).returning();
    await load();
    setSelected(row.id);
  }

  async function remove(n: Note) {
    if (!window.confirm(t("nb.confirmDelete"))) return;
    window.clearTimeout(timer.current);
    dirty.current = false;
    await removeAttachmentsOf(NO_PROJECT, "pnote", n.id);
    await db.delete(schema.personal_notes).where(eq(schema.personal_notes.id, n.id));
    const rows = await load();
    setSelected(rows?.[0]?.id ?? null);
  }

  async function sendToProject() {
    if (!note || !user || draft.project_id === "none") return;
    setSending(true);
    try {
      const projectId = Number(draft.project_id);
      await save(note.id, draft);
      const text = projectNoteText(draft);
      if (note.shared_note_id) {
        await db.update(schema.project_notes).set({ body: text, visibility }).where(eq(schema.project_notes.id, note.shared_note_id));
        await removeAttachmentsOf(projectId, "note", note.shared_note_id);
        await copyAttachments({ projectId: NO_PROJECT, owner: "pnote", ownerId: note.id }, { projectId, owner: "note", ownerId: note.shared_note_id }, user.id);
        await db.update(schema.personal_notes).set({ shared_visibility: visibility }).where(eq(schema.personal_notes.id, note.id));
      } else {
        const [created] = await db.insert(schema.project_notes).values({ project_id: projectId, user_id: user.id, body: text, visibility }).returning();
        await copyAttachments({ projectId: NO_PROJECT, owner: "pnote", ownerId: note.id }, { projectId, owner: "note", ownerId: created.id }, user.id);
        await db.update(schema.personal_notes).set({ shared_note_id: created.id, shared_visibility: visibility }).where(eq(schema.personal_notes.id, note.id));
      }
      await load();
    } finally {
      setSending(false);
    }
  }

  async function unlink() {
    if (!note?.shared_note_id || !note.project_id) return;
    await removeAttachmentsOf(note.project_id, "note", note.shared_note_id);
    await db.delete(schema.project_notes).where(and(eq(schema.project_notes.id, note.shared_note_id), eq(schema.project_notes.project_id, note.project_id)));
    await db.update(schema.personal_notes).set({ shared_note_id: null, shared_visibility: null }).where(eq(schema.personal_notes.id, note.id));
    await load();
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? notes.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q)) : notes;
  }, [notes, query]);

  const project = projectOf(draft.project_id === "none" ? null : Number(draft.project_id));
  const color = project ? projectColor(project) : "var(--primary)";

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.section.client")}
        title={t("nav.notebook")}
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              {t("nb.private")}
            </span>
            <Button onClick={() => void create()}>
              <Plus className="size-4" />
              {t("nb.new")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="relative border-b bg-muted/30 p-3">
            <Search className="pointer-events-none absolute top-5.5 left-6 size-4 text-muted-foreground" />
            <Input className="h-9 pl-9" value={query} placeholder={t("nb.search")} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {shown.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">{t("nb.empty")}</p>
          ) : (
            <ul className="max-h-[70vh] divide-y overflow-y-auto">
              {shown.map((n) => {
                const p = projectOf(n.project_id);
                const c = p ? projectColor(p) : null;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(n.id)}
                      className={cn("block w-full px-4 py-3 text-left transition-colors hover:bg-foreground/5", selected === n.id && "bg-foreground/5")}
                      style={selected === n.id ? { boxShadow: `inset 3px 0 0 ${c ?? "var(--primary)"}` } : undefined}
                    >
                      <span className="block truncate font-medium">{n.title.trim() || t("nb.untitled")}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body.trim() || "—"}</span>
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatDateTime(n.updated_on, locale)}</span>
                        {p ? (
                          <span className="inline-flex max-w-40 items-center gap-1 truncate rounded-full px-2 py-0.5 font-medium" style={{ background: `color-mix(in srgb, ${c} 18%, transparent)` }}>
                            {p.name}
                          </span>
                        ) : null}
                        {n.shared_note_id ? <Send className="size-3" aria-label={t("nb.inProject")} /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {note ? (
          <Card className="gap-4 p-5" style={{ boxShadow: `var(--glass-shadow), inset 0 3px 0 ${color}` }}>
            <div className="flex items-start gap-3">
              <NotebookPen className="mt-2 size-5 shrink-0" style={{ color }} />
              <Input correct className="h-10 flex-1 border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0" value={draft.title} placeholder={t("nb.titlePh")} onChange={(e) => change({ title: e.target.value })} />
              <span className="mt-2 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : state === "saved" ? <Check className="size-3" /> : null}
                {state === "saving" ? t("nb.saving") : state === "saved" ? t("nb.saved") : null}
              </span>
              <Button size="icon-sm" variant="ghost" aria-label={t("exp.delete")} onClick={() => void remove(note)}>
                <Trash2 className="size-4" />
              </Button>
            </div>

            <Textarea className="min-h-56 resize-y" rows={10} value={draft.body} placeholder={t("nb.bodyPh")} onChange={(e) => change({ body: e.target.value })} />

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("nb.files")}</Label>
              <Attachments projectId={NO_PROJECT} owner="pnote" ownerId={note.id} />
            </div>

            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("nb.project")}</Label>
                <Select value={draft.project_id} disabled={Boolean(note.shared_note_id)} onValueChange={(v) => change({ project_id: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("nb.noProject")}</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {draft.project_id !== "none" ? (
                <div className="space-y-1.5">
                  <Label>{t("nb.sendAs")}</Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISIBILITIES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {t(`nb.vis.${v}` as MessageKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            {draft.project_id !== "none" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void sendToProject()} disabled={sending || !projectNoteText(draft)}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {note.shared_note_id ? t("nb.update") : t("nb.send")}
                </Button>
                {note.shared_note_id ? (
                  <Button variant="outline" onClick={() => void unlink()}>
                    <Undo2 className="size-4" />
                    {t("nb.unlink")}
                  </Button>
                ) : null}
                {note.shared_note_id ? <span className="text-xs text-muted-foreground">{t("nb.inProject")}</span> : null}
              </div>
            ) : null}
          </Card>
        ) : (
          <Card className="flex min-h-64 items-center justify-center p-8 text-sm text-muted-foreground">{t("nb.pickSelect")}</Card>
        )}
      </div>
    </div>
  );
}
