import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, LogIn, LogOut, ShieldCheck, Timer, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { logActivity } from "@/lib/activity";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  addDaysISO,
  formatClock,
  formatDuration,
  loadAllPunches,
  loadUserPunches,
  minutesBetween,
  openPunchForUser,
  pairPunches,
  projectFence,
  submitPunch,
  weekStartISO,
  type PunchFailure,
  type TimeEntry,
} from "@/lib/timeclock";
import { useNow } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { PunchRuleBanner } from "@/components/PunchRule";
import { PunchFailureDialog } from "@/components/PunchFailureDialog";
import type { Client, Project, TimePunch, User } from "@/lib/types";
import { db, dbReady, schema } from "../db";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PunchPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { projects, clients } = useWorkspace();
  const isAdmin = Boolean(user?.is_admin);
  const [loading, setLoading] = useState(true);
  const [myPunches, setMyPunches] = useState<TimePunch[]>([]);
  const [allPunches, setAllPunches] = useState<TimePunch[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [memberRows, setMemberRows] = useState<{ project_id: number; user_id: number }[]>([]);
  const [open, setOpen] = useState<TimePunch | null>(null);
  // Checking in is the everyday task, so it is the default even for admins.
  const [tab, setTab] = useState("clock");

  async function load() {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      await dbReady;
      const mine = await loadUserPunches(user.id);
      setMyPunches(mine);
      const current = await openPunchForUser(user.id);
      setOpen(current);
      if (isAdmin) {
        setAllPunches(await loadAllPunches());
        setPeople(((await db.select().from(schema.users)) as User[]).filter((p) => p.user_type === "internal"));
        const members = (await db.select().from(schema.project_members)) as { project_id: number; user_id: number }[];
        setMemberRows(members);
      }
    } catch (err) {
      console.error("punch load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdmin]);

  if (loading) return <PageSkeleton />;
  if (user?.user_type === "external") {
    return (
      <EmptyState
        icon={<Timer className="size-5" />}
        title={t("punch.restricted")}
        description={t("punch.restrictedDesc")}
      />
    );
  }

  const clock = (
    <ClockView
      punches={myPunches}
      open={open}
      projects={projects}
      clients={clients}
      onChanged={load}
    />
  );

  if (!isAdmin) {
    return (
      <div>
        <PageHeader eyebrow={t("nav.section.field")} title={t("punch.title")} description={t("punch.desc")} />
        {clock}
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow={t("nav.section.field")} title={t("punch.title")} description={t("punch.adminDesc")} />
      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList>
          <TabsTrigger value="overview">
            <Users className="size-3.5" />
            {t("punch.tab.overview")}
          </TabsTrigger>
          <TabsTrigger value="clock">
            <Clock3 className="size-3.5" />
            {t("punch.tab.clock")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <PunchOverview
            punches={allPunches}
            projects={projects}
            clients={clients}
            people={people}
            memberRows={memberRows}
          />
        </TabsContent>
        <TabsContent value="clock">{clock}</TabsContent>
      </Tabs>
    </div>
  );
}

function ClockView({
  punches,
  open,
  projects,
  clients,
  onChanged,
}: {
  punches: TimePunch[];
  open: TimePunch | null;
  projects: Project[];
  clients: Client[];
  onChanged: () => Promise<void>;
}) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  // Default to the open shift, else the job punched on last, else the first job.
  const lastProjectId = punches.find((p) => projects.some((job) => job.id === p.project_id))?.project_id;
  const [projectId, setProjectId] = useState(
    open ? String(open.project_id) : lastProjectId ? String(lastProjectId) : projects[0] ? String(projects[0].id) : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [failure, setFailure] = useState<PunchFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const now = useNow(Boolean(open));

  useEffect(() => {
    if (open) setProjectId(String(open.project_id));
  }, [open?.id]);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(id);
  }, [success]);

  const selected = projects.find((p) => String(p.id) === projectId) ?? null;
  const openProject = open ? projects.find((p) => p.id === open.project_id) ?? selected : null;
  const ruleProject = openProject ?? selected;
  const entries = useMemo(() => pairPunches(punches).slice(0, 8), [punches]);
  const liveMs = open ? now - new Date(open.punched_at).getTime() : 0;
  const liveMinutes = Math.max(0, Math.floor(liveMs / 60000));

  async function punch(kind: "in" | "out") {
    const project = kind === "out" ? openProject : selected;
    if (!user || !project || busy) return;
    setBusy(kind);
    setFailure(null);
    setSuccess(null);
    try {
      const result = await submitPunch({ userId: user.id, project, kind, note: note.trim() || null });
      if (!result.ok) {
        setFailure(result.failure);
        // The real state differs from what this screen showed: resync it.
        if (result.failure.code === "punch.error.alreadyIn" || result.failure.code === "punch.error.notIn") {
          await onChanged();
        }
        return;
      }
      const time = new Date(result.punch.punched_at).toLocaleTimeString(locale === "fr" ? "fr-CA" : "en-CA", {
        hour: "2-digit",
        minute: "2-digit",
      });
      setSuccess(
        kind === "in"
          ? t("punch.success.in", { time })
          : t("punch.success.out", {
              time,
              duration: formatDuration(open ? minutesBetween(open.punched_at, result.punch.punched_at) : 0),
            }),
      );
      setNote("");
      void logActivity({
        action: kind === "in" ? "punched in" : "punched out",
        details: `${project.project_number} ${project.name}`,
        projectId: project.id,
        clientId: project.client_id,
        userId: user.id,
      }).catch(() => undefined);
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  const failureProject = failure?.open ? projects.find((p) => p.id === failure.open!.project_id) : ruleProject;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="gap-0 overflow-hidden p-0">
        {/* Status */}
        <div
          className={cn(
            "relative px-6 py-6 sm:px-8",
            open ? "bg-black text-white" : "bg-muted/50",
          )}
        >
          {open ? <div className="frx-beam absolute inset-x-0 top-0 h-1" aria-hidden /> : null}
          <p className="frx-label flex items-center gap-2">
            <span className="relative flex size-2.5">
              {open ? <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" /> : null}
              <span className={cn("relative size-2.5 rounded-full", open ? "bg-emerald-400" : "bg-muted-foreground/50")} />
            </span>
            <span className={open ? "text-emerald-300" : "text-muted-foreground"}>
              {open ? t("punch.state.on") : t("punch.state.off")}
            </span>
          </p>
          <p className="mt-3 font-mono text-[44px] font-medium leading-none tabular-nums sm:text-[56px]">
            {open ? formatClock(liveMs) : "0:00:00"}
          </p>
          {open && openProject ? (
            <div className="mt-3 space-y-1">
              <p className="text-[15px] font-semibold">
                {openProject.project_number} · {openProject.name}
              </p>
              <p className="text-[13px] text-white/60">
                {t("punch.since", { time: formatDateTime(open.punched_at, locale) })} · {clientName(openProject, clients)}
              </p>
              <p className="pt-2 text-[12px] text-white/50">{t("punch.keepsRunning")}</p>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">{t("punch.chooseProject")}</p>
          )}
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="space-y-1.5">
            <Label>{t("punch.project")}</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={Boolean(open)}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder={t("punch.selectProject")} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.project_number} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {open ? <p className="text-xs text-muted-foreground">{t("punch.lockedProject")}</p> : null}
          </div>

          {ruleProject ? <PunchRuleBanner project={ruleProject} /> : null}

          <div className="space-y-1.5">
            <Label>{t("punch.note")}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("punch.notePlaceholder")} rows={2} />
          </div>

          {success ? (
            <p
              className="flex items-center gap-2 rounded-sm border border-emerald-600/30 bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-800 dark:text-emerald-300"
              role="status"
            >
              <CheckCircle2 className="size-4 shrink-0" />
              {success}
            </p>
          ) : null}

          {open ? (
            <Button
              size="lg"
              disabled={Boolean(busy)}
              onClick={() => void punch("out")}
              className="h-14 w-full bg-foreground font-display text-lg font-bold uppercase tracking-[0.16em] text-background shadow-none hover:bg-foreground/85"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}
              {busy ? (ruleProject && projectFence(ruleProject) ? t("punch.checking") : t("punch.saving")) : t("punch.out")}
            </Button>
          ) : (
            <Button
              size="lg"
              disabled={Boolean(busy) || !selected}
              onClick={() => void punch("in")}
              className="h-14 w-full font-display text-lg font-bold uppercase tracking-[0.16em]"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
              {busy ? (ruleProject && projectFence(ruleProject) ? t("punch.checking") : t("punch.saving")) : t("punch.in")}
            </Button>
          )}
          <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            {t("punch.locationOnlyOnTap")}
          </p>
        </div>
      </Card>

      <Card className="gap-3 p-5">
        <p className="frx-label text-muted-foreground">{t("punch.recent")}</p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("punch.noEntries")}</p>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => {
              const project = projects.find((p) => p.id === entry.punchIn.project_id);
              return (
                <li key={entry.punchIn.id} className="flex items-start justify-between gap-3 py-3 text-sm first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{project?.name ?? t("billing.noProject")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.punchIn.punched_at, locale)}
                      {entry.punchOut ? ` → ${formatDateTime(entry.punchOut.punched_at, locale)}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono tabular-nums">
                      {entry.open ? formatDuration(liveMinutes) : formatDuration(entry.minutes)}
                    </p>
                    <StatusBadge value={entry.open ? "in_progress" : "complete"} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <PunchFailureDialog
        failure={failure}
        projectName={failureProject ? `${failureProject.project_number} ${failureProject.name}` : undefined}
        onClose={() => setFailure(null)}
        onRetry={() => {
          const kind = open ? "out" : "in";
          setFailure(null);
          void punch(kind);
        }}
      />
    </div>
  );
}

function PunchOverview({
  punches,
  projects,
  clients,
  people,
  memberRows,
}: {
  punches: TimePunch[];
  projects: Project[];
  clients: Client[];
  people: User[];
  memberRows: { project_id: number; user_id: number }[];
}) {
  const { t, locale } = useI18n();
  const [week, setWeek] = useState(weekStartISO());
  const [projectId, setProjectId] = useState("all");
  const [personId, setPersonId] = useState("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const weekEnd = addDaysISO(week, 7);

  const employeeOptions = useMemo(() => {
    if (projectId === "all") return people;
    const pid = Number(projectId);
    const ids = new Set<number>();
    for (const row of memberRows) {
      if (row.project_id === pid) ids.add(row.user_id);
    }
    for (const punch of punches) {
      if (punch.project_id === pid) ids.add(punch.user_id);
    }
    return people.filter((p) => ids.has(p.id));
  }, [projectId, people, memberRows, punches]);

  useEffect(() => {
    if (personId !== "all" && !employeeOptions.some((p) => String(p.id) === personId)) {
      setPersonId("all");
    }
  }, [employeeOptions, personId]);

  const filtered = useMemo(() => {
    return punches.filter((p) => {
      const day = p.punched_at.slice(0, 10);
      if (day < week || day >= weekEnd) return false;
      if (projectId !== "all" && p.project_id !== Number(projectId)) return false;
      if (personId !== "all" && p.user_id !== Number(personId)) return false;
      return true;
    });
  }, [punches, week, weekEnd, projectId, personId]);

  const entries = useMemo(() => pairPunches(filtered), [filtered]);
  const closed = entries.filter((e) => !e.open);
  const openEntries = useMemo(() => {
    const lastByUser = new Map<number, TimePunch>();
    for (const punch of punches) {
      if (!lastByUser.has(punch.user_id)) lastByUser.set(punch.user_id, punch);
    }
    return [...lastByUser.values()].filter((p) => {
      if (p.kind !== "in") return false;
      if (projectId !== "all" && p.project_id !== Number(projectId)) return false;
      if (personId !== "all" && p.user_id !== Number(personId)) return false;
      return true;
    });
  }, [punches, projectId, personId]);

  const totalMinutes = closed.reduce((sum, e) => sum + e.minutes, 0) +
    openEntries.reduce((sum, p) => sum + minutesBetween(p.punched_at, new Date(now).toISOString()), 0);
  const peopleCount = new Set(filtered.map((p) => p.user_id)).size;
  const projectCount = new Set(filtered.map((p) => p.project_id)).size;
  const avg = closed.length ? Math.round(closed.reduce((sum, e) => sum + e.minutes, 0) / closed.length) : 0;
  const flagged = filtered.filter((p) => p.status !== "ok").length;

  const byProject = summarize(closed, (e) => e.punchIn.project_id);
  const byPerson = summarize(closed, (e) => e.punchIn.user_id);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("punch.overview.desc")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>{t("punch.filter.week")}</Label>
          <Input type="date" value={week} onChange={(e) => setWeek(weekStartISO(new Date(`${e.target.value}T00:00:00`)))} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("punch.filter.project")}</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("punch.filter.allProjects")}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.project_number} — {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("punch.filter.employee")}</Label>
          <Select value={personId} onValueChange={setPersonId}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("punch.filter.allPeople")}</SelectItem>
              {employeeOptions.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="pb-2 text-sm text-muted-foreground">
          {formatDate(week, locale)} – {formatDate(addDaysISO(week, 6), locale)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("punch.stat.hours")} value={formatDuration(totalMinutes)} hint={t("punch.stat.shifts") + ` · ${closed.length}`} />
        <StatCard label={t("punch.stat.open")} value={String(openEntries.length)} hint={t("punch.stat.people") + ` · ${peopleCount}`} />
        <StatCard label={t("punch.stat.avg")} value={formatDuration(avg)} hint={t("punch.stat.projects") + ` · ${projectCount}`} />
        <StatCard label={t("punch.stat.flagged")} value={String(flagged)} hint={t("punch.list")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <p className="text-sm font-medium">{t("punch.liveCrew")}</p>
          {openEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("punch.noLive")}</p>
          ) : (
            <ul className="space-y-2.5">
              {openEntries.map((p) => {
                const project = projects.find((job) => job.id === p.project_id);
                const person = people.find((u) => u.id === p.user_id);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{person?.name ?? `#${p.user_id}`}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {project?.project_number} · {project?.name}
                      </p>
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {formatDuration(minutesBetween(p.punched_at, new Date(now).toISOString()))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="gap-3 p-4">
          <p className="text-sm font-medium">{t("punch.byProject")}</p>
          {byProject.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("punch.emptyLog")}</p>
          ) : (
            <ul className="space-y-2">
              {byProject.slice(0, 8).map(([id, minutes]) => {
                const project = projects.find((p) => p.id === id);
                return (
                  <li key={id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {project?.project_number} · {project?.name ?? id}
                    </span>
                    <span className="tabular-nums">{formatDuration(minutes)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <p className="text-sm font-medium">{t("punch.byPerson")}</p>
          {byPerson.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("punch.emptyLog")}</p>
          ) : (
            <ul className="space-y-2">
              {byPerson.slice(0, 8).map(([id, minutes]) => (
                <li key={id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{people.find((p) => p.id === id)?.name ?? `#${id}`}</span>
                  <span className="tabular-nums">{formatDuration(minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="gap-3 p-4">
          <p className="text-sm font-medium">{t("punch.list")}</p>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("punch.emptyLog")}</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t("punch.employee")}</th>
                    <th className="py-2 pr-3 font-medium">{t("punch.project")}</th>
                    <th className="py-2 text-right font-medium">{t("timesheet.hours")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.slice(0, 40).map((entry) => (
                    <PunchRow
                      key={entry.punchIn.id}
                      entry={entry}
                      projects={projects}
                      clients={clients}
                      people={people}
                      now={now}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function PunchRow({
  entry,
  projects,
  clients,
  people,
  now,
}: {
  entry: TimeEntry;
  projects: Project[];
  clients: Client[];
  people: User[];
  now: number;
}) {
  const { locale } = useI18n();
  const project = projects.find((p) => p.id === entry.punchIn.project_id);
  const person = people.find((p) => p.id === entry.punchIn.user_id);
  const minutes = entry.open ? minutesBetween(entry.punchIn.punched_at, new Date(now).toISOString()) : entry.minutes;
  return (
    <tr>
      <td className="py-2 pr-3">
        <p className="font-medium">{person?.name ?? `#${entry.punchIn.user_id}`}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(entry.punchIn.punched_at, locale)}</p>
      </td>
      <td className="py-2 pr-3">
        <p className="truncate">{project?.name ?? "—"}</p>
        <p className="text-xs text-muted-foreground">
          {project?.project_number}
          {project ? ` · ${clientName(project, clients)}` : ""}
        </p>
      </td>
      <td className="py-2 text-right tabular-nums">
        {formatDuration(minutes)}
        {entry.open ? <StatusBadge value="in_progress" /> : null}
      </td>
    </tr>
  );
}

function summarize(entries: TimeEntry[], key: (e: TimeEntry) => number) {
  const map = new Map<number, number>();
  for (const entry of entries) {
    const id = key(entry);
    map.set(id, (map.get(id) ?? 0) + entry.minutes);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function clientName(project: Project, clients: { id: number; company_name: string }[]) {
  return clients.find((c) => c.id === project.client_id)?.company_name ?? "";
}
