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
  const [section, setSection] = useState("all");
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

  // sections: like the tabs of a paper notebook, one per project that has notes, plus the notes with no project
  const sections = useMemo(() => {
    const ids = [...new Set(notes.map((n) => n.project_id).filter((id): id is number => id !== null))];
    return ids.flatMap((id) => {
      const p = projectOf(id);
      return p ? [{ key: String(id), label: p.name, color: projectColor(p), n: notes.filter((n) => n.project_id === id).length }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, projects]);
  const loose = notes.filter((n) => n.project_id === null).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => section === "all" || (section === "none" ? n.project_id === null : String(n.project_id) === section))
      .filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q));
  }, [notes, query, section]);

  const project = projectOf(draft.project_id === "none" ? null : Number(draft.project_id));
  const color = project ? projectColor(project) : "#e4002b";
  const stampLabel = note ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", { dateStyle: "full", timeStyle: "short" }).format(new Date(note.created_on)) : "";

  const tabs = [
    { key: "all", label: t("sch.filter.all"), color: "#8a8577", n: notes.length },
    { key: "none", label: t("nb.general"), color: "#6b7280", n: loose },
    ...sections,
  ];

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

      {/* section tabs, like the coloured tabs of a notebook */}
      <div className="flex flex-wrap items-end gap-1 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSection(tab.key)}
            className={cn(
              "flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition-all",
              section === tab.key ? "translate-y-px bg-[#fbfaf5] text-[#1f2a44] shadow-sm" : "bg-muted/50 text-muted-foreground hover:bg-muted",
            )}
            style={{ boxShadow: `inset 0 3px 0 ${tab.color}` }}
          >
            <span className="max-w-44 truncate">{tab.label}</span>
            <span className="text-[10px] tabular-nums opacity-70">{tab.n}</span>
          </button>
        ))}
      </div>

      <div className="grid overflow-hidden rounded-2xl rounded-tl-none border bg-[#fbfaf5] text-[#1f2a44] shadow-lg lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* the pages of the section */}
        <aside className="border-b bg-[#f1eee3] lg:border-r lg:border-b-0">
          <div className="relative border-b border-[#ddd6c2] p-3">
            <Search className="pointer-events-none absolute top-5.5 left-6 size-4 text-[#8a8577]" />
            <Input className="h-9 border-[#d6cfba] bg-white/70 pl-9 dark:bg-white/70 text-[#1f2a44] placeholder:text-[#8a8577]" value={query} placeholder={t("nb.search")} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {shown.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[#6b665a]">{t("nb.empty")}</p>
          ) : (
            <ul className="max-h-[72vh] overflow-y-auto">
              {shown.map((n) => {
                const p = projectOf(n.project_id);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(n.id)}
                      className={cn("block w-full border-b border-[#e3ddc9] px-4 py-2.5 text-left transition-colors hover:bg-white/60", selected === n.id && "bg-white shadow-[inset_3px_0_0_#e4002b]")}
                    >
                      <span className="block truncate text-sm font-semibold">{n.title.trim() || t("nb.untitled")}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#6b665a]">
                        <span>{formatDateTime(n.updated_on, locale)}</span>
                        {p && section === "all" ? <span className="size-2 shrink-0 rounded-full" style={{ background: projectColor(p) }} title={p.name} /> : null}
                        {n.shared_note_id ? <Send className="size-3" aria-label={t("nb.inProject")} /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* the page: lined paper with a red margin and punched holes */}
        {note ? (
          <section className="relative min-w-0">
            {[14, 50, 86].map((top) => (
              <span key={top} aria-hidden className="absolute left-3 hidden size-3.5 rounded-full bg-[#2a2a28]/85 shadow-[inset_0_2px_3px_rgba(0,0,0,0.6)] sm:block" style={{ top: `${top}%` }} />
            ))}
            <span aria-hidden className="absolute inset-y-0 left-14 w-px bg-[#e57373]/70" />
            <span aria-hidden className="absolute inset-y-0 left-[58px] w-px bg-[#e57373]/40" />

            <div className="flex items-start gap-3 py-4 pr-4 pl-20">
              <div className="min-w-0 flex-1">
                <Input
                  correct
                  className="h-11 border-0 bg-transparent px-0 font-display text-3xl font-semibold tracking-wide md:text-3xl text-[#1f2a44] shadow-none placeholder:text-[#9a9585] focus-visible:ring-0 dark:bg-transparent"
                  value={draft.title}
                  placeholder={t("nb.titlePh")}
                  onChange={(e) => change({ title: e.target.value })}
                />
                <p className="mt-1 flex items-center gap-2 text-xs text-[#6b665a]">
                  <span className="capitalize">{stampLabel}</span>
                  <span className="flex items-center gap-1">
                    {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : state === "saved" ? <Check className="size-3" /> : null}
                    {state === "saving" ? t("nb.saving") : state === "saved" ? t("nb.saved") : null}
                  </span>
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" className="text-[#6b665a] hover:bg-black/5 hover:text-[#b3261e]" aria-label={t("exp.delete")} onClick={() => void remove(note)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="mx-4 mb-2 h-0.5 rounded-full bg-[#1f2a44]/15 sm:ml-0" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

            <Textarea
              className="min-h-[440px] resize-none rounded-none border-0 bg-transparent py-0 pr-6 pl-20 text-[16px] leading-8 text-[#1f2a44] shadow-none placeholder:text-[#9a9585] focus-visible:ring-0 dark:bg-transparent"
              style={{ backgroundImage: "repeating-linear-gradient(transparent 0 31px, #b8d0e8 31px 32px)", backgroundAttachment: "local" }}
              value={draft.body}
              placeholder={t("nb.bodyPh")}
              onChange={(e) => change({ body: e.target.value })}
            />

            <div className="space-y-4 border-t border-[#ddd6c2] bg-[#f6f3e8] py-4 pr-6 pl-20">
              <div className="space-y-2">
                <Label className="text-[11px] uppercase tracking-wider text-[#6b665a]">{t("nb.files")}</Label>
                <Attachments projectId={NO_PROJECT} owner="pnote" ownerId={note.id} />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full max-w-xs space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-[#6b665a]">{t("nb.project")}</Label>
                  <Select value={draft.project_id} disabled={Boolean(note.shared_note_id)} onValueChange={(v) => change({ project_id: v })}>
                    <SelectTrigger className="w-full bg-white/80 dark:bg-white/80 dark:hover:bg-white/90">
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
                  <div className="w-full max-w-xs space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-[#6b665a]">{t("nb.sendAs")}</Label>
                    <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                      <SelectTrigger className="w-full bg-white/80 dark:bg-white/80 dark:hover:bg-white/90">
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

                {draft.project_id !== "none" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void sendToProject()} disabled={sending || !projectNoteText(draft)}>
                      {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      {note.shared_note_id ? t("nb.update") : t("nb.send")}
                    </Button>
                    {note.shared_note_id ? (
                      <Button variant="outline" className="bg-white/80" onClick={() => void unlink()}>
                        <Undo2 className="size-4" />
                        {t("nb.unlink")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <div className="flex min-h-80 items-center justify-center gap-3 p-8 text-sm text-[#6b665a]">
            <NotebookPen className="size-5" />
            {t("nb.pickSelect")}
          </div>
        )}
      </div>
    </div>
  );
}
