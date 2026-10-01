import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { pairPunches } from "@/lib/timeclock";
import { PunchRuleChip } from "@/components/PunchRule";
import { PUNCH_RULE_ANCHOR, PunchRuleEditor } from "@/components/project/PunchRuleEditor";
import { Link, useNavigate, useParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { ArrowLeft, FolderKanban, Pencil, Plus, Users } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { formatDate, money, moneyExact, percent, todayISO } from "@/lib/format";
import { visibleProjectModules } from "@/lib/permissions";
import {
  BUDGET_CATEGORIES,
  BUDGET_STATUSES,
  CO_STATUSES,
  DOC_CATEGORIES,
  EVENT_TYPES,
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
  PUNCH_STATUSES,
  RFI_STATUSES,
  SAFETY_SEVERITIES,
  SAFETY_STATUSES,
  TASK_STATUSES,
  TEAM_ROLES,
} from "@/lib/constants";
import type { Client, CompanyProfile, ModuleId, Project, TimePunch, User } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { CalendarSection, ScheduleSection } from "@/components/project/ProjectPlanViews";
import { SharePointLibrary } from "@/components/project/SharePointLibrary";
import { ProjectReportsSection } from "@/components/project/ProjectReportsSection";
import { getCompanyProfile } from "@/lib/settings";
import { isProjectSection, projectSectionPath } from "@/lib/project-nav";
import {
  applyProjectFolder,
  formFromProject,
  ProjectFormFields,
  projectInsertValues,
  useSharePointFolders,
  type ProjectFormValues,
} from "@/components/ProjectFormFields";

export function ProjectDetailPage() {
  const { projectId, section: sectionParam } = useParams();
  const id = Number(projectId);
  const navigate = useNavigate();
  const { user, permissions, can } = useAuth();
  const { t, locale } = useI18n();
  const section: ModuleId = isProjectSection(sectionParam) ? sectionParam : "dashboard";

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [clientName, setClientName] = useState("");
  const [people, setPeople] = useState<User[]>([]);
  const [members, setMembers] = useState<{ user_id: number; role: string }[]>([]);
  const [tasks, setTasks] = useState<(typeof schema.project_tasks.$inferSelect)[]>([]);
  const [budget, setBudget] = useState<(typeof schema.budget_items.$inferSelect)[]>([]);
  const [events, setEvents] = useState<(typeof schema.calendar_events.$inferSelect)[]>([]);
  const [rfis, setRfis] = useState<(typeof schema.rfis.$inferSelect)[]>([]);
  const [cos, setCos] = useState<(typeof schema.change_orders.$inferSelect)[]>([]);
  const [logs, setLogs] = useState<(typeof schema.daily_logs.$inferSelect)[]>([]);
  const [punch, setPunch] = useState<(typeof schema.punch_items.$inferSelect)[]>([]);
  const [incidents, setIncidents] = useState<(typeof schema.safety_incidents.$inferSelect)[]>([]);
  const [labour, setLabour] = useState<{ name: string; minutes: number; job: string }[]>([]);
  const [savedReports, setSavedReports] = useState<(typeof schema.project_reports.$inferSelect)[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [clientRow, setClientRow] = useState<Client | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormValues | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editFolders = useSharePointFolders(editOpen, id);

  async function load() {
    // Always leave the loading state, even if a query fails, so the page
    // never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
      if (!rows[0]) {
        setProject(null);
        setLoading(false);
        return;
      }
      const clients = await db.select().from(schema.clients).where(eq(schema.clients.id, rows[0].client_id));
      const users = (await db.select().from(schema.users)) as User[];
      const mems = await db.select().from(schema.project_members).where(eq(schema.project_members.project_id, id));
      setProject(rows[0] as Project);
      setClientName(clients[0]?.company_name ?? "");
      setClientRow((clients[0] as Client) ?? null);
      setCompany(await getCompanyProfile());
      setPeople(users);
      setMembers(mems.map((m) => ({ user_id: m.user_id, role: m.role })));
      setTasks(await db.select().from(schema.project_tasks).where(eq(schema.project_tasks.project_id, id)));
      setBudget(await db.select().from(schema.budget_items).where(eq(schema.budget_items.project_id, id)));
      setEvents(await db.select().from(schema.calendar_events).where(eq(schema.calendar_events.project_id, id)));
      setRfis(await db.select().from(schema.rfis).where(eq(schema.rfis.project_id, id)));
      setCos(await db.select().from(schema.change_orders).where(eq(schema.change_orders.project_id, id)));
      setLogs(await db.select().from(schema.daily_logs).where(eq(schema.daily_logs.project_id, id)));
      setPunch(await db.select().from(schema.punch_items).where(eq(schema.punch_items.project_id, id)));
      setIncidents(await db.select().from(schema.safety_incidents).where(eq(schema.safety_incidents.project_id, id)));
      const punches = (await db.select().from(schema.time_punches).where(eq(schema.time_punches.project_id, id))) as TimePunch[];
      const labourMap = new Map<number, { name: string; minutes: number; job: string }>();
      for (const entry of pairPunches(punches)) {
        const person = users.find((u) => u.id === entry.punchIn.user_id);
        const prev = labourMap.get(entry.punchIn.user_id);
        labourMap.set(entry.punchIn.user_id, {
          name: person?.name ?? `#${entry.punchIn.user_id}`,
          minutes: (prev?.minutes ?? 0) + entry.minutes,
          job: rows[0].name as string,
        });
      }
      setLabour([...labourMap.values()].sort((a, b) => b.minutes - a.minutes));
      setSavedReports(await db.select().from(schema.project_reports).where(eq(schema.project_reports.project_id, id)));
      setLoading(false);
    } catch (err) {
      console.error("ProjectDetailPage load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const allowed = useMemo(
    () => visibleProjectModules(user, permissions, id),
    [user, permissions, id],
  );

  useEffect(() => {
    if (allowed.length && !allowed.includes(section)) {
      navigate(projectSectionPath(id, allowed[0]), { replace: true });
    }
  }, [allowed, section, id, navigate]);

  async function refreshSpent() {
    const items = await db.select().from(schema.budget_items).where(eq(schema.budget_items.project_id, id));
    const spent = items.reduce((s, i) => s + i.actual, 0);
    await db.update(schema.projects).set({ spent }).where(eq(schema.projects.id, id));
    setBudget(items);
    setProject((p) => (p ? { ...p, spent } : p));
  }

  if (loading) return <PageSkeleton />;
  if (!project) {
    return (
      <EmptyState
        icon={<FolderKanban className="size-5" />}
        title="Project not found"
        description="This job may have been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/projects">Back to projects</Link>
          </Button>
        }
      />
    );
  }

  const scope = { projectId: id };
  const used = percent(project.spent, project.budget);

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link to={`/clients/${project.client_id}`}>
          <ArrowLeft className="size-4" />
          {clientName || t("projects.clientFallback")}
        </Link>
      </Button>

      <PageHeader
        eyebrow={project.project_number}
        title={project.name}
        description={project.description || `${project.city ?? ""} · ${project.project_type ?? ""}`}
        actions={
          <>
            <PunchRuleChip
              project={project}
              onClick={
                user?.is_admin
                  ? () => {
                      if (section !== "dashboard") navigate(projectSectionPath(id, "dashboard"));
                      window.setTimeout(
                        () => document.getElementById(PUNCH_RULE_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" }),
                        section === "dashboard" ? 0 : 350,
                      );
                    }
                  : undefined
              }
            />
            <StatusBadge value={project.status} />
            <StatusBadge value={project.phase} />
            {user?.is_admin || user?.user_type === "internal" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditForm(formFromProject(project));
                  setEditOpen(true);
                }}
              >
                <Pencil className="size-4" />
                {t("projects.edit")}
              </Button>
            ) : null}
          </>
        }
      />

      <div>
          {section === "dashboard" && (
            <Dashboard
              project={project}
              used={used}
              tasks={tasks}
              rfis={rfis}
              punch={punch}
              incidents={incidents}
              events={events}
              logs={logs}
              canEditGeo={Boolean(user?.is_admin)}
              onSaveGeo={async (next) => {
                await db
                  .update(schema.projects)
                  .set({
                    geo_lat: next.geo_lat,
                    geo_lng: next.geo_lng,
                    geo_radius_m: next.geo_radius_m,
                    require_geofence: next.require_geofence,
                  })
                  .where(eq(schema.projects.id, id));
                setProject({ ...project, ...next });
              }}
            />
          )}
          {section === "calendar" && (
            <CalendarSection
              events={events}
              tasks={tasks}
              rfis={rfis}
              punch={punch}
              canCreate={can("calendar", "create", scope)}
              onAdd={() => setDialog("event")}
            />
          )}
          {section === "budget" && (
            <BudgetSection
              items={budget}
              project={project}
              canCreate={can("budget", "create", scope)}
              onAdd={() => setDialog("budget")}
            />
          )}
          {section === "tasks" && (
            <ScheduleSection
              tasks={tasks}
              people={people}
              canCreate={can("tasks", "create", scope)}
              onAdd={() => setDialog("task")}
            />
          )}
          {section === "documents" && (
            <SharePointLibrary
              projectId={id}
              projectName={project.name}
              client={clientRow}
              canCreate={can("documents", "create", scope)}
            />
          )}
          {section === "rfis" && (
            <ListSection
              title={t("project.nav.rfis")}
              empty={t("project.rfisEmpty")}
              canCreate={can("rfis", "create", scope)}
              onAdd={() => setDialog("rfi")}
              rows={rfis.map((r) => ({
                id: r.id,
                title: `${r.number} · ${r.title}`,
                meta: r.description || t("project.due", { date: formatDate(r.due_date, locale) }),
                status: r.status,
                extra: formatDate(r.due_date, locale),
              }))}
            />
          )}
          {section === "change_orders" && (
            <ListSection
              title="Change orders"
              empty="No change orders."
              canCreate={can("change_orders", "create", scope)}
              onAdd={() => setDialog("co")}
              rows={cos.map((c) => ({
                id: c.id,
                title: `${c.number} · ${c.title}`,
                meta: c.description || "",
                status: c.status,
                extra: money(c.amount),
              }))}
            />
          )}
          {section === "daily_logs" && (
            <ListSection
              title="Daily logs"
              empty="No site reports yet."
              canCreate={can("daily_logs", "create", scope)}
              onAdd={() => setDialog("log")}
              rows={logs.map((l) => ({
                id: l.id,
                title: formatDate(l.log_date),
                meta: `${l.weather ?? "—"} · ${l.crew_count} on site`,
                status: "in_progress",
                extra: l.notes ?? "",
              }))}
            />
          )}
          {section === "punch" && (
            <ListSection
              title="Punch list"
              empty="No deficiencies recorded."
              canCreate={can("punch", "create", scope)}
              onAdd={() => setDialog("punch")}
              rows={punch.map((p) => ({
                id: p.id,
                title: p.title,
                meta: p.location || "",
                status: p.status,
                extra: p.priority,
              }))}
            />
          )}
          {section === "safety" && (
            <ListSection
              title="Safety"
              empty="No incidents or observations."
              canCreate={can("safety", "create", scope)}
              onAdd={() => setDialog("safety")}
              rows={incidents.map((s) => ({
                id: s.id,
                title: s.title,
                meta: `${formatDate(s.incident_date)} · ${s.description ?? ""}`,
                status: s.severity,
                extra: s.status,
              }))}
            />
          )}
          {section === "team" && (
            <TeamSection
              members={members}
              people={people}
              canCreate={can("team", "create", scope)}
              onAdd={() => setDialog("member")}
            />
          )}
          {section === "reports" && company ? (
            <ProjectReportsSection
              project={project}
              client={clientRow}
              company={company}
              pack={{
                tasks,
                budget,
                rfis,
                changes: cos,
                punch,
                incidents,
                logs,
                members,
                people,
                labour,
                portfolio: [
                  {
                    name: project.name,
                    number: project.project_number,
                    client: clientName,
                    status: project.status,
                    budget: project.budget,
                    spent: project.spent,
                  },
                ],
              }}
              saved={savedReports}
              canCreate={can("reports", "create", scope) || Boolean(user?.is_admin)}
              preparedBy={user?.name ?? ""}
              onSaveCustom={async (name, sections) => {
                await db.insert(schema.project_reports).values({
                  project_id: id,
                  name,
                  sections: sections.join(","),
                  created_by: user?.id ?? null,
                });
                await logActivity({ action: "saved report", details: name, projectId: id, userId: user?.id });
                await load();
              }}
              onDeleteCustom={async (reportId) => {
                await db.delete(schema.project_reports).where(eq(schema.project_reports.id, reportId));
                await load();
              }}
            />
          ) : null}
      </div>

      <EventDialog
        open={dialog === "event"}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.calendar_events).values({ ...v, project_id: id });
          await logActivity({ action: "scheduled event", details: v.title, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <BudgetDialog
        open={dialog === "budget"}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.budget_items).values({ ...v, project_id: id });
          await logActivity({ action: "added budget line", details: v.description, projectId: id, userId: user?.id });
          setDialog(null);
          await refreshSpent();
        }}
      />
      <TaskDialog
        open={dialog === "task"}
        people={people}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.project_tasks).values({ ...v, project_id: id });
          await logActivity({ action: "added task", details: v.title, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <DocDialog
        open={dialog === "doc"}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.documents).values({ ...v, project_id: id, uploaded_by: user?.id ?? null });
          await logActivity({ action: "added document", details: v.name, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <RfiDialog
        open={dialog === "rfi"}
        people={people}
        nextNumber={`RFI-${String(rfis.length + 1).padStart(3, "0")}`}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.rfis).values({ ...v, project_id: id });
          await logActivity({ action: "opened RFI", details: v.title, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <CoDialog
        open={dialog === "co"}
        nextNumber={`CO-${String(cos.length + 1).padStart(3, "0")}`}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.change_orders).values({ ...v, project_id: id });
          await logActivity({ action: "created change order", details: v.title, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <LogDialog
        open={dialog === "log"}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.daily_logs).values({ ...v, project_id: id, created_by: user?.id ?? null });
          await logActivity({ action: "posted daily log", details: v.log_date, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <PunchDialog
        open={dialog === "punch"}
        people={people}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.punch_items).values({ ...v, project_id: id });
          await logActivity({ action: "added punch item", details: v.title, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <SafetyDialog
        open={dialog === "safety"}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.safety_incidents).values({ ...v, project_id: id });
          await logActivity({ action: "logged safety incident", details: v.title, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <MemberDialog
        open={dialog === "member"}
        people={people.filter((p) => !members.some((m) => m.user_id === p.id))}
        onClose={() => setDialog(null)}
        onSave={async (v) => {
          await db.insert(schema.project_members).values({ project_id: id, user_id: v.user_id, role: v.role });
          await logActivity({ action: "added team member", details: v.role, projectId: id, userId: user?.id });
          setDialog(null);
          await load();
        }}
      />
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projects.edit")}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setEditSaving(true);
                  try {
                    const values = projectInsertValues(editForm, project.client_id, {
                      spent: project.spent,
                      sort_order: project.sort_order,
                    });
                    await db
                      .update(schema.projects)
                      .set({
                        name: values.name,
                        project_number: values.project_number,
                        description: values.description,
                        status: values.status,
                        phase: values.phase,
                        project_type: values.project_type,
                        address: values.address,
                        city: values.city,
                        start_date: values.start_date,
                        end_date: values.end_date,
                        budget: values.budget,
                      })
                      .where(eq(schema.projects.id, id));
                    await applyProjectFolder({
                      projectId: id,
                      clientId: project.client_id,
                      projectName: editForm.name.trim(),
                      folderMode: editFolders.folderMode,
                      folderId: editFolders.folderId,
                      folderName: editFolders.folderName,
                      folderDrive: editFolders.folderDrive,
                      folderChoices: editFolders.folderChoices,
                    });
                    setEditOpen(false);
                    await load();
                  } finally {
                    setEditSaving(false);
                  }
                })();
              }}
            >
              <ProjectFormFields
                form={editForm}
                onChange={setEditForm}
                folderMode={editFolders.folderMode}
                onFolderMode={editFolders.setFolderMode}
                folderChoices={editFolders.folderChoices}
                folderId={editFolders.folderId}
                onFolderId={editFolders.setFolderId}
                folderName={editFolders.folderName}
                onFolderName={editFolders.setFolderName}
                assignedName={editFolders.assignedName}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  {t("clients.cancel")}
                </Button>
                <Button type="submit" disabled={editSaving || !editForm.name.trim()}>
                  {editSaving ? t("clients.saving") : t("projects.save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Dashboard({
  project,
  used,
  tasks,
  rfis,
  punch,
  incidents,
  events,
  logs,
  canEditGeo,
  onSaveGeo,
}: {
  project: Project;
  used: number;
  tasks: { status: string }[];
  rfis: { status: string }[];
  punch: { status: string }[];
  incidents: { status: string }[];
  events: { title: string; event_date: string; event_type: string }[];
  logs: { log_date: string; crew_count: number }[];
  canEditGeo: boolean;
  onSaveGeo: (next: {
    geo_lat: number | null;
    geo_lng: number | null;
    geo_radius_m: number | null;
    require_geofence: number;
  }) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const openRfi = rfis.filter((r) => r.status === "open").length;
  const openPunch = punch.filter((p) => p.status !== "complete").length;
  const openSafety = incidents.filter((s) => s.status !== "closed").length;
  const upcoming = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date)).slice(0, 5);
  const latestCrew = logs[0]?.crew_count ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label={t("project.budgetUsed")} value={`${used}%`} hint={t("project.ofBudget", { spent: money(project.spent, locale), budget: money(project.budget, locale) })} />
        <MiniStat label={t("project.openRfis")} value={String(openRfi)} hint={t("project.punchOpen", { n: openPunch })} />
        <MiniStat label={t("project.safetyOpen")} value={String(openSafety)} hint={t("project.safetyTotal", { n: incidents.length })} />
        <MiniStat label={t("project.lastCrew")} value={String(latestCrew)} hint={logs[0] ? formatDate(logs[0].log_date, locale) : t("project.noLog")} />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(used, 100)}%` }} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="text-base">Upcoming on the calendar</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {upcoming.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">{t("project.nothingScheduled")}</p>
            ) : (
              <ul className="divide-y">
                {upcoming.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 truncate">{e.title}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge value={e.event_type} />
                      <span className="text-xs text-muted-foreground tabular-nums">{formatDate(e.event_date)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-base">Contract</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 px-5 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Value</span>
              <span className="tabular-nums">{money(project.budget)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Spent</span>
              <span className="tabular-nums">{money(project.spent)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Remaining</span>
              <span className="tabular-nums">{money(Math.max(project.budget - project.spent, 0))}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Window</span>
              <span>
                {formatDate(project.start_date)} – {formatDate(project.end_date)}
              </span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Tasks in flight</span>
              <span className="tabular-nums">{tasks.filter((t) => t.status === "in_progress").length}</span>
            </p>
          </CardContent>
        </Card>
      </div>
      {canEditGeo ? <PunchRuleEditor project={project} onSave={onSaveGeo} /> : null}
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  const numeric = Number(value.replace("%", ""));
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-[13px] font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="font-display text-3xl font-semibold tabular-nums tracking-tight">
          {Number.isFinite(numeric) && !value.includes("%") ? (
            <NumberTicker value={numeric} className="font-display" />
          ) : (
            value
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function BudgetSection({
  items,
  project,
  canCreate,
  onAdd,
}: {
  items: (typeof schema.budget_items.$inferSelect)[];
  project: Project;
  canCreate: boolean;
  onAdd: () => void;
}) {
  const { t, locale } = useI18n();
  const est = items.reduce((s, i) => s + i.estimated, 0);
  const act = items.reduce((s, i) => s + i.actual, 0);
  return (
    <div>
      <SectionHead title={t("project.nav.budget")} action={canCreate ? onAdd : undefined} actionLabel={t("project.addLine")} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label={t("project.estimated")} value={money(est || project.budget, locale)} hint={t("project.sumCodes")} />
        <MiniStat label={t("project.actualCommitted")} value={money(act, locale)} hint={t("project.ofEstimate", { pct: percent(act, est || project.budget) })} />
        <MiniStat label={t("project.variance")} value={money((est || project.budget) - act, locale)} hint={t("project.estMinusAct")} />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("project.col.category")}</th>
              <th className="px-4 py-3 font-medium">{t("project.col.description")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("project.col.estimated")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("project.col.actual")}</th>
              <th className="px-4 py-3 font-medium">{t("project.col.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3">{i.category}</td>
                <td className="px-4 py-3 text-muted-foreground">{i.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{moneyExact(i.estimated)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{moneyExact(i.actual)}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={i.status} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {t("project.noCostCodes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListSection({
  title,
  empty,
  rows,
  canCreate,
  onAdd,
}: {
  title: string;
  empty: string;
  rows: { id: number; title: string; meta: string; status: string; extra: string }[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  return (
    <div>
      <SectionHead title={title} action={canCreate ? onAdd : undefined} actionLabel="Add" />
      {rows.length === 0 ? (
        <EmptyState icon={<FolderKanban className="size-5" />} title={empty} description="Use Add when you have permission." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.title}</p>
                {r.meta && <p className="truncate text-xs text-muted-foreground">{r.meta}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={r.status} />
                {r.extra && <span className="text-xs text-muted-foreground">{r.extra}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamSection({
  members,
  people,
  canCreate,
  onAdd,
}: {
  members: { user_id: number; role: string }[];
  people: User[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  return (
    <div>
      <SectionHead title="Project team" action={canCreate ? onAdd : undefined} actionLabel="Add member" />
      {members.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="No one assigned" description="Add internal staff or client contacts." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {members.map((m) => {
            const u = people.find((p) => p.id === m.user_id);
            if (!u) return null;
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar name={u.name} hint={u.avatar_initials} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.role} · {u.email}
                  </p>
                </div>
                <StatusBadge value={u.user_type} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionHead({
  title,
  action,
  actionLabel,
}: {
  title: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      {action && (
        <Button size="sm" onClick={action}>
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function EventDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (v: { title: string; event_date: string; end_date: string | null; event_type: string; description: string | null }) => Promise<void>;
}) {
  const [form, setForm] = useState({ title: "", event_date: todayISO(), end_date: "", event_type: "milestone", description: "" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      title: form.title.trim(),
      event_date: form.event_date,
      end_date: form.end_date || null,
      event_type: form.event_type,
      description: form.description.trim() || null,
    });
    setSaving(false);
    setForm({ title: "", event_date: todayISO(), end_date: "", event_type: "milestone", description: "" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input type="date" required value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={form.event_type} onValueChange={(v) => setForm({ ...form, event_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BudgetDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (v: { category: string; description: string; estimated: number; actual: number; status: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ category: "General conditions", description: "", estimated: "", actual: "0", status: "planned" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      category: form.category,
      description: form.description.trim(),
      estimated: Number(form.estimated) || 0,
      actual: Number(form.actual) || 0,
      status: form.status,
    });
    setSaving(false);
    setForm({ category: "General conditions", description: "", estimated: "", actual: "0", status: "planned" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Budget line</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Category">
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description">
            <Input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estimated">
              <Input type="number" min="0" value={form.estimated} onChange={(e) => setForm({ ...form, estimated: e.target.value })} />
            </Field>
            <Field label="Actual">
              <Input type="number" min="0" value={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.value })} />
            </Field>
          </div>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({
  open,
  onClose,
  onSave,
  people,
}: {
  open: boolean;
  onClose: () => void;
  people: User[];
  onSave: (v: { title: string; description: string | null; start_date: string | null; end_date: string | null; status: string; priority: string; assigned_to: number | null }) => Promise<void>;
}) {
  const [form, setForm] = useState({ title: "", description: "", start_date: todayISO(), end_date: "", status: "not_started", priority: "medium", assigned_to: "" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      title: form.title.trim(),
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status,
      priority: form.priority,
      assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
    });
    setSaving(false);
    setForm({ title: "", description: "", start_date: todayISO(), end_date: "", status: "not_started", priority: "medium", assigned_to: "" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Work package</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start">
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="End">
              <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Assignee">
            <Select value={form.assigned_to || "none"} onValueChange={(v) => setForm({ ...form, assigned_to: v === "none" ? "" : v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (v: { name: string; category: string; notes: string | null }) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: "", category: "Drawings", notes: "" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({ name: form.name.trim(), category: form.category, notes: form.notes.trim() || null });
    setSaving(false);
    setForm({ name: "", category: "Drawings", notes: "" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RfiDialog({
  open,
  onClose,
  onSave,
  people,
  nextNumber,
}: {
  open: boolean;
  onClose: () => void;
  people: User[];
  nextNumber: string;
  onSave: (v: { number: string; title: string; description: string | null; status: string; assigned_to: number | null; due_date: string | null }) => Promise<void>;
}) {
  const [form, setForm] = useState({ number: nextNumber, title: "", description: "", status: "open", assigned_to: "", due_date: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm((f) => ({ ...f, number: nextNumber }));
  }, [open, nextNumber]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      number: form.number.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
      due_date: form.due_date || null,
    });
    setSaving(false);
    setForm({ number: nextNumber, title: "", description: "", status: "open", assigned_to: "", due_date: "" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New RFI</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Number">
              <Input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </Field>
            <Field label="Due">
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </Field>
          </div>
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Question">
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RFI_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Assigned">
              <Select value={form.assigned_to || "none"} onValueChange={(v) => setForm({ ...form, assigned_to: v === "none" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CoDialog({
  open,
  onClose,
  onSave,
  nextNumber,
}: {
  open: boolean;
  onClose: () => void;
  nextNumber: string;
  onSave: (v: { number: string; title: string; description: string | null; amount: number; status: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ number: nextNumber, title: "", description: "", amount: "", status: "draft" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm((f) => ({ ...f, number: nextNumber }));
  }, [open, nextNumber]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      number: form.number.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      amount: Number(form.amount) || 0,
      status: form.status,
    });
    setSaving(false);
    setForm({ number: nextNumber, title: "", description: "", amount: "", status: "draft" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change order</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Number">
              <Input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </Field>
            <Field label="Amount">
              <Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
          </div>
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CO_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LogDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (v: { log_date: string; weather: string | null; crew_count: number; notes: string | null }) => Promise<void>;
}) {
  const [form, setForm] = useState({ log_date: todayISO(), weather: "", crew_count: "0", notes: "" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      log_date: form.log_date,
      weather: form.weather.trim() || null,
      crew_count: Number(form.crew_count) || 0,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    setForm({ log_date: todayISO(), weather: "", crew_count: "0", notes: "" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Daily log</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input type="date" required value={form.log_date} onChange={(e) => setForm({ ...form, log_date: e.target.value })} />
            </Field>
            <Field label="Crew count">
              <Input type="number" min="0" value={form.crew_count} onChange={(e) => setForm({ ...form, crew_count: e.target.value })} />
            </Field>
          </div>
          <Field label="Weather">
            <Input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PunchDialog({
  open,
  onClose,
  onSave,
  people,
}: {
  open: boolean;
  onClose: () => void;
  people: User[];
  onSave: (v: { title: string; location: string | null; status: string; priority: string; assigned_to: number | null; due_date: string | null }) => Promise<void>;
}) {
  const [form, setForm] = useState({ title: "", location: "", status: "open", priority: "medium", assigned_to: "", due_date: "" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      title: form.title.trim(),
      location: form.location.trim() || null,
      status: form.status,
      priority: form.priority,
      assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
      due_date: form.due_date || null,
    });
    setSaving(false);
    setForm({ title: "", location: "", status: "open", priority: "medium", assigned_to: "", due_date: "" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Punch item</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PUNCH_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assigned">
              <Select value={form.assigned_to || "none"} onValueChange={(v) => setForm({ ...form, assigned_to: v === "none" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due">
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SafetyDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (v: { incident_date: string; severity: string; title: string; description: string | null; status: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ incident_date: todayISO(), severity: "observation", title: "", description: "", status: "open" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      incident_date: form.incident_date,
      severity: form.severity,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
    });
    setSaving(false);
    setForm({ incident_date: todayISO(), severity: "observation", title: "", description: "", status: "open" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Safety record</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input type="date" required value={form.incident_date} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} />
            </Field>
            <Field label="Severity">
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SAFETY_SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAFETY_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberDialog({
  open,
  onClose,
  onSave,
  people,
}: {
  open: boolean;
  onClose: () => void;
  people: User[];
  onSave: (v: { user_id: number; role: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ user_id: "", role: "Coordinator" });
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.user_id) return;
    setSaving(true);
    await onSave({ user_id: Number(form.user_id), role: form.role });
    setSaving(false);
    setForm({ user_id: "", role: "Coordinator" });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Person">
            <Select value={form.user_id || undefined} onValueChange={(v) => setForm({ ...form, user_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select someone" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} · {p.user_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Role">
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.user_id}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

void PROJECT_PHASES;
void PROJECT_STATUSES;
