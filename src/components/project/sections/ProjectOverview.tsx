import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { asc, desc, eq } from "drizzle-orm";
import { CalendarClock, CheckCircle2, ChevronRight, Image as ImageIcon, RefreshCw, Sparkles, Users } from "lucide-react";
import { db, schema } from "../../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { formatDate, todayISO } from "@/lib/format";
import { PROJECT_PHASES } from "@/lib/constants";
import { projectColor } from "@/lib/project-colors";
import { projectAchievement, scheduleElapsed } from "@/lib/project-progress";
import { latestPhotos, type Attachment } from "@/lib/project-files";
import { fetchAiSummary } from "@/lib/daily-summary";
import { projectSectionPath } from "@/lib/project-nav";
import { PhaseBar } from "@/components/ProjectCabinet";
import { Thumb } from "@/components/project/Attachments";
import { UserAvatar } from "@/components/UserAvatar";
import { ProjectTeamDialog } from "@/components/project/ProjectTeamDialog";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SectionProps } from "./types";

type Task = typeof schema.project_tasks.$inferSelect;
type Note = typeof schema.project_notes.$inferSelect;

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

function Ring({ percent, color }: { percent: number; color: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 128 128" className="size-36 -rotate-90" aria-hidden>
      <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" stroke={`color-mix(in srgb, ${color} 16%, transparent)`} />
      <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" strokeLinecap="round" stroke={color} strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)", filter: `drop-shadow(0 0 6px ${color})` }} />
    </svg>
  );
}

/**
 * Overview: a dashboard for the project that is always reassuring. It shows progress, what is done, what is next and
 * the latest from the site, with a short "work in progress" message that only ever talks about the good news.
 */
export function ProjectOverview({ project, client, people, members, reload }: SectionProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_admin) && user?.view_as !== "client";
  const [teamOpen, setTeamOpen] = useState(false);
  const color = projectColor(project);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [shared, setShared] = useState<Note[]>([]);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [text, setText] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t1, n1, p1] = await Promise.all([
      db.select().from(schema.project_tasks).where(eq(schema.project_tasks.project_id, project.id)).orderBy(asc(schema.project_tasks.end_date)),
      db.select().from(schema.project_notes).where(eq(schema.project_notes.project_id, project.id)).orderBy(desc(schema.project_notes.created_at)).catch(() => [] as Note[]),
      latestPhotos(project.id, 8).catch(() => [] as Attachment[]),
    ]);
    setTasks(t1);
    setShared(n1.filter((n) => n.visibility === "everyone").slice(0, 3));
    setPhotos(p1);
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const today = todayISO();
  const a = projectAchievement(project, tasks.map((x) => ({ project_id: x.project_id, status: x.status })));
  const phaseIdx = Math.max(0, PROJECT_PHASES.findIndex((p) => p.value === project.phase));
  const elapsed = scheduleElapsed(project.start_date, project.end_date, today);
  const left = project.end_date ? days(today, project.end_date) : null;
  const done = tasks.filter((x) => x.status === "completed");
  const recentDone = [...done].sort((x, y) => (y.end_date ?? "").localeCompare(x.end_date ?? "")).slice(0, 4);
  const next = tasks.filter((x) => x.status !== "completed" && (!x.end_date || x.end_date >= today)).slice(0, 4);
  const now = tasks.filter((x) => x.status === "in_progress").slice(0, 3);
  const team = members.map((m) => ({ ...m, person: people.find((p) => p.id === m.user_id) })).filter((m) => m.person);

  // Only good news goes to the writer: what is done, what is under way, what comes next.
  const facts = {
    project: project.name,
    phase: t(`phase.${project.phase}` as MessageKey),
    phaseNumber: phaseIdx + 1,
    phaseCount: PROJECT_PHASES.length,
    progressPercent: a.percent,
    tasksDone: a.done,
    tasksTotal: a.total,
    recentlyCompleted: recentDone.map((x) => x.title),
    underWay: now.map((x) => x.title),
    comingNext: next.map((x) => ({ title: x.title, date: x.start_date })),
    sharedNotes: shared.map((n) => n.body.slice(0, 120)),
    plannedEnd: project.end_date,
  };

  function fallback() {
    const parts = [a.total ? t("ov2.fb.progress", { name: project.name, done: a.done, total: a.total, phase: facts.phase }) : t("ov2.fb.start", { name: project.name, phase: facts.phase })];
    if (now[0]) parts.push(t("ov2.fb.now", { title: now[0].title }));
    else if (next[0]) parts.push(t("ov2.fb.next", { title: next[0].title }));
    return parts.join(" ");
  }

  const generate = useCallback(
    async (force: boolean) => {
      const key = `frx.projectSummary.${project.id}.${locale}`;
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(key) || "null") as { date: string; text: string } | null;
          if (cached && cached.date === todayISO() && cached.text) {
            setText(cached.text);
            setAi(true);
            return;
          }
        } catch {
          /* storage unavailable */
        }
      }
      setBusy(true);
      const written = await fetchAiSummary(facts, locale, "project");
      if (written) {
        setText(written);
        setAi(true);
        try {
          localStorage.setItem(key, JSON.stringify({ date: todayISO(), text: written }));
        } catch {
          /* storage unavailable */
        }
      } else {
        setText(fallback());
        setAi(false);
      }
      setBusy(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, locale, tasks.length, a.done],
  );
  // Write once the tasks are in, then keep the text for the day.
  useEffect(() => {
    if (tasks.length === 0 && text !== null) return;
    void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="justify-between gap-4 p-6" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${color} 14%, var(--card)), color-mix(in srgb, var(--card) 85%, transparent))`, boxShadow: `var(--glass-shadow), inset 4px 0 0 ${color}` }}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color }}>
            <Sparkles className="size-4" />
            {t("ov2.title")}
            <Button type="button" size="icon-sm" variant="ghost" className="ml-auto" aria-label={t("dash.sum.refresh")} disabled={busy} onClick={() => void generate(true)}>
              <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
          {text === null ? (
            <div className="space-y-2 py-1">
              <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-9/12 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <p className="text-lg leading-relaxed">{text}</p>
          )}
          {ai ? <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("dash.sum.ai")}</p> : null}
        </Card>

        <Card className="items-center justify-center gap-1 p-5">
          <div className="relative">
            <Ring percent={a.percent} color={color} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-4xl leading-none tabular-nums">{a.percent}%</span>
              <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("gantt.achievement")}</span>
            </div>
          </div>
          {a.total ? <p className="text-xs text-muted-foreground">{t("cab.tasks", { done: a.done, total: a.total })}</p> : null}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-3 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("gantt.phase")}</p>
          <PhaseBar project={project} color={color} />
        </Card>
        <Card className="gap-3 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("ov2.schedule")}</p>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
            <div className="h-full rounded-full" style={{ width: `${elapsed}%`, background: color }} />
          </div>
          <p className="text-sm tabular-nums">
            {project.start_date ? formatDate(project.start_date, locale) : "…"} → {project.end_date ? formatDate(project.end_date, locale) : "…"}
            {left !== null && left >= 0 && project.status !== "completed" ? <span className="text-muted-foreground"> · {t("gantt.timeLeft", { n: left })}</span> : null}
          </p>
        </Card>
        <Card className="gap-3 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("ov2.done")}</p>
          <p className="font-display text-3xl leading-none tabular-nums">
            {done.length}
            <span className="text-lg text-muted-foreground"> / {tasks.length}</span>
          </p>
          <p className="text-xs text-muted-foreground">{t("ov2.doneHint")}</p>
        </Card>
        <Card className="gap-3 p-5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Users className="size-3.5" />
            {t("ov2.team")}
            {isAdmin ? (
              <button type="button" className="ml-auto rounded px-1.5 text-[10px] font-semibold normal-case tracking-normal text-foreground/70 underline-offset-2 hover:text-foreground hover:underline" onClick={() => setTeamOpen(true)}>
                {t("team.manage")}
              </button>
            ) : null}
          </p>
          <ul className="space-y-1.5">
            {team.slice(0, 4).map((m) => (
              <li key={m.user_id} className="flex items-center gap-2 text-sm">
                <UserAvatar name={m.person!.name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{m.person!.name}</span>
                <span className="text-xs text-muted-foreground">{m.role}</span>
              </li>
            ))}
            {team.length === 0 ? <li className="text-sm text-muted-foreground">—</li> : null}
          </ul>
        </Card>
      </div>

      <ProjectTeamDialog open={teamOpen} project={project} client={client} people={people} members={members} onClose={() => setTeamOpen(false)} onSaved={() => void reload()} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="gap-3 p-5">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <CheckCircle2 className="size-4" style={{ color }} />
            {t("ov2.recent")}
          </h3>
          <ul className="space-y-2">
            {recentDone.map((x) => (
              <li key={x.id} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color }} />
                <span>{x.title}</span>
              </li>
            ))}
            {recentDone.length === 0 ? <li className="text-sm text-muted-foreground">{t("ov2.recentNone")}</li> : null}
          </ul>
        </Card>

        <Card className="gap-3 p-5">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <CalendarClock className="size-4" style={{ color }} />
            {t("ov2.next")}
          </h3>
          <ul className="space-y-2">
            {[...now, ...next.filter((x) => !now.includes(x))].slice(0, 4).map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="min-w-0">{x.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{x.start_date ? formatDate(x.start_date, locale) : ""}</span>
              </li>
            ))}
            {now.length + next.length === 0 ? <li className="text-sm text-muted-foreground">{t("ov2.nextNone")}</li> : null}
          </ul>
          <Link to={projectSectionPath(project.id, "tasks")} className="mt-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("pnav.schedule")}
            <ChevronRight className="size-3.5" />
          </Link>
        </Card>

        <Card className="gap-3 p-5">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <ImageIcon className="size-4" style={{ color }} />
            {t("ov2.site")}
          </h3>
          {photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {photos.slice(0, 6).map((p) => (
                <Thumb key={p.id} file={p} onOpen={() => undefined} />
              ))}
            </div>
          ) : null}
          <ul className="space-y-2">
            {shared.map((n) => (
              <li key={n.id} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="line-clamp-3">{n.body}</p>
              </li>
            ))}
            {shared.length === 0 && photos.length === 0 ? <li className="text-sm text-muted-foreground">{t("ov2.siteNone")}</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
