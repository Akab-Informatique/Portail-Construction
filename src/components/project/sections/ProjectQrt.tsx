import { useCallback, useEffect, useState } from "react";
import { asc, eq } from "drizzle-orm";
import { CheckCircle2, Clock, HelpCircle, Loader2, MessageCircleQuestion, Pencil, Plus, Search, Send, Trash2 } from "lucide-react";
import { db, schema } from "../../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { countAttachments, removeAttachmentsOf } from "@/lib/project-files";
import { notifyEvent, notifySummary, sendNotification } from "@/lib/notify";
import { Attachments } from "@/components/project/Attachments";
import { NotifyPicker, type NotifyChoice } from "@/components/project/NotifyPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

type Entry = typeof schema.project_qrt.$inferSelect;

/** React runs effects twice in development; one project must only be filled in once. */
const seeding = new Map<number, Promise<void>>();

/**
 * QRT, the question-answer work log. It starts with the answers we already know about the job,
 * and the client's questions land here and tell the people in charge by email and text message.
 */
export function ProjectQrt({ project, client, people, members }: SectionProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const color = projectColor(project);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [fileCount, setFileCount] = useState<Record<number, number>>({});
  const [filter, setFilter] = useState<"all" | "open" | "answered">("all");
  const [query, setQuery] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [fromClient, setFromClient] = useState(false);
  const [notify, setNotify] = useState<NotifyChoice>({ userIds: [], channels: ["email", "sms"] });
  const [answering, setAnswering] = useState<Entry | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A client account asks questions and reads the answers; it cannot answer, edit or delete.
  const viewer = user?.user_type === "external" || user?.view_as === "client";

  const staff = people.filter((p) => p.user_type === "internal");
  const inCharge = members.map((m) => m.user_id);
  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "";

  const load = useCallback(async () => {
    let rows = await db.select().from(schema.project_qrt).where(eq(schema.project_qrt.project_id, project.id)).orderBy(asc(schema.project_qrt.id));
    // First visit: fill in what we already know about the job.
    if (rows.length === 0 && !viewer) {
      const running = seeding.get(project.id);
      if (running) {
        await running;
        rows = await db.select().from(schema.project_qrt).where(eq(schema.project_qrt.project_id, project.id)).orderBy(asc(schema.project_qrt.id));
        setEntries(rows);
        return;
      }
      let release: () => void = () => undefined;
      seeding.set(project.id, new Promise<void>((resolve) => (release = resolve)));
      try {
      const lead = members.map((m) => `${who(m.user_id)} (${m.role})`).filter((x) => !x.startsWith(" (")).join(", ");
      const location = [project.address, project.city].filter(Boolean).join(", ");
      const dates = project.start_date || project.end_date ? `${project.start_date ? formatDate(project.start_date, locale) : "…"} → ${project.end_date ? formatDate(project.end_date, locale) : "…"}` : "";
      const contact = client ? [client.company_name, client.name, client.email, client.phone].filter(Boolean).join(" · ") : "";
      const pre: [string, string][] = [
        [t("qrt.pre.q1"), location],
        [t("qrt.pre.q2"), dates],
        [t("qrt.pre.q3"), project.description || project.project_type || ""],
        [t("qrt.pre.q4"), lead],
        [t("qrt.pre.q5"), contact],
        [t("qrt.pre.q6"), t("qrt.pre.a6")],
      ];
      const filled = pre.filter(([, a]) => a);
      if (filled.length) {
        await db.insert(schema.project_qrt).values(
          filled.map(([q, a]) => ({ project_id: project.id, question: q, answer: a, origin: "staff", status: "answered", asked_by: null, answered_by: user?.id ?? null, answered_at: new Date(), prefilled: 1 })),
        );
        rows = await db.select().from(schema.project_qrt).where(eq(schema.project_qrt.project_id, project.id)).orderBy(asc(schema.project_qrt.id));
      }
      } finally {
        release();
        seeding.delete(project.id);
      }
    }
    setEntries(rows);
    setFileCount(await countAttachments(project.id, "qrt"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, viewer]);
  useEffect(() => {
    void load();
  }, [load]);

  async function ask() {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setMessage(null);
    try {
      const [created] = await db.insert(schema.project_qrt).values({
        project_id: project.id,
        question: text,
        answer: null,
        origin: viewer || fromClient ? "client" : "staff",
        status: "open",
        asked_by: user?.id ?? null,
        answered_by: null,
        answered_at: null,
        prefilled: 0,
      }).returning();
      // a client's question tells the people on the project by email
      if (viewer && created) void notifyEvent("qrt", created.id);
      if (!viewer && notify.userIds.length && notify.channels.length) {
        const result = await sendNotification({
          userIds: notify.userIds,
          channels: notify.channels,
          subject: `${t("qrt.notifySubject")} · ${project.project_number} ${project.name}`,
          text: `${text.slice(0, 500)}\n\n${window.location.origin}/projects/${project.id}/qrt`,
        });
        setMessage(notifySummary(result, t as never));
      }
      setQuestion("");
      setAskOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveAnswer() {
    if (!answering) return;
    const text = answerText.trim();
    await db
      .update(schema.project_qrt)
      .set({ answer: text || null, status: text ? "answered" : "open", answered_by: text ? user?.id ?? null : null, answered_at: text ? new Date() : null })
      .where(eq(schema.project_qrt.id, answering.id));
    setAnswering(null);
    await load();
  }

  const shown = entries
    .filter((e) => (filter === "all" ? true : e.status === filter))
    .filter((e) => !query.trim() || `${e.question} ${e.answer ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.id - a.id);
  const waiting = entries.filter((e) => e.status === "open").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5 max-w-full overflow-x-auto">
            {(["all", "open", "answered"] as const).map((f) => (
              <Button key={f} type="button" size="sm" variant={filter === f ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setFilter(f)}>
                {t(`qrt.filter.${f}`)}
                {f === "open" && waiting ? <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">{waiting}</span> : null}
              </Button>
            ))}
          </div>
          <div className="relative w-60">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input className="pl-9" value={query} placeholder={t("qrt.search")} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <Button
          onClick={() => {
            setQuestion("");
            setFromClient(false);
            setAskOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t("qrt.ask")}
        </Button>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}

      {shown.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">{t("qrt.empty")}</Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((e) => {
            const open = e.status === "open";
            return (
              <li key={e.id}>
                <Card className="gap-3 p-5" style={{ boxShadow: `var(--glass-shadow), inset 3px 0 0 ${open ? "var(--destructive)" : color}` }}>
                  <div className="flex items-start gap-3">
                    <MessageCircleQuestion className="mt-0.5 size-5 shrink-0" style={{ color }} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{e.question}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span className={cn("rounded-full px-2 py-0.5 font-semibold", e.origin === "client" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-muted")}>
                          {e.prefilled ? t("qrt.prefilled") : e.origin === "client" ? t("qrt.fromClient") : t("qrt.fromTeam")}
                        </span>
                        <span>{formatDateTime(e.created_at, locale)}</span>
                        {e.asked_by ? <span>{who(e.asked_by)}</span> : null}
                      </p>
                    </div>
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", open ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>
                      {open ? <Clock className="size-3" /> : <CheckCircle2 className="size-3" />}
                      {open ? t("qrt.waiting") : t("qrt.answered")}
                    </span>
                  </div>

                  {e.answer ? (
                    <div className="rounded-xl border bg-muted/30 px-4 py-3">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.answer}</p>
                      {e.answered_by && !e.prefilled ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {who(e.answered_by)}
                          {e.answered_at ? ` · ${formatDateTime(e.answered_at, locale)}` : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <HelpCircle className="size-4" />
                      {t("qrt.noAnswer")}
                    </p>
                  )}

                  <div className={cn("flex flex-wrap items-center justify-between gap-2", viewer && "hidden")}>
                    <Button
                      size="sm"
                      variant={open ? "default" : "outline"}
                      onClick={() => {
                        setAnswering(e);
                        setAnswerText(e.answer ?? "");
                      }}
                    >
                      {open ? <Send className="size-4" /> : <Pencil className="size-4" />}
                      {open ? t("qrt.answer") : t("qrt.editAnswer")}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("exp.delete")}
                      onClick={async () => {
                        if (!window.confirm(t("qrt.deleteConfirm"))) return;
                        await removeAttachmentsOf(project.id, "qrt", e.id);
                        await db.delete(schema.project_qrt).where(eq(schema.project_qrt.id, e.id));
                        await load();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {viewer && !fileCount[e.id] ? null : <Attachments projectId={project.id} owner="qrt" ownerId={e.id} canEdit={!viewer} compact={!fileCount[e.id]} onChange={() => void load()} />}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={askOpen} onOpenChange={setAskOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("qrt.ask")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>{t("qrt.question")}</Label>
              <Textarea autoFocus rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>
            {viewer ? null : (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={fromClient} onChange={(e) => setFromClient(e.target.checked)} />
                  {t("qrt.asByClient")}
                </label>
                <NotifyPicker people={staff} value={notify} onChange={setNotify} preselect={inCharge} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskOpen(false)}>{t("clients.cancel")}</Button>
            <Button onClick={() => void ask()} disabled={busy || !question.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("qrt.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(answering)} onOpenChange={(o) => !o && setAnswering(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{answering?.question}</DialogTitle>
          </DialogHeader>
          <Textarea autoFocus rows={6} value={answerText} placeholder={t("qrt.answerPlaceholder")} onChange={(e) => setAnswerText(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnswering(null)}>{t("clients.cancel")}</Button>
            <Button onClick={() => void saveAnswer()}>{t("settings.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
