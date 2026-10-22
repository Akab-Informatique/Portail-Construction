import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { inArray } from "drizzle-orm";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Eye,
  EyeOff,
  LayoutDashboard,
  Settings2,
} from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { withProjectMoney } from "@/lib/project-money";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortfolioCalendar, marksFromPortfolio } from "@/components/PortfolioCalendar";
import { DailySummary } from "@/components/DailySummary";
import { PortfolioGantt } from "@/components/PortfolioGantt";
import { ensureProjectColors } from "@/lib/project-colors";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import type { Client, Project } from "@/lib/types";
import { getAccessibleClientIds } from "@/lib/access";
import {
  DEFAULT_DASHBOARD,
  loadDashboardLayout,
  saveDashboardLayout,
  type DashboardWidget,
  type DashboardWidgetId,
} from "@/lib/dashboard-layout";

type CalEvent = { id: number; event_date: string; title: string; event_type: string; project_id: number };
type CalTask = { id: number; end_date: string | null; title: string; project_id: number; status: string };
type CalRfi = { id: number; due_date: string | null; number: string; title: string; project_id: number };
type CalPunch = { id: number; due_date: string | null; title: string; project_id: number };

export function DashboardPage() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<DashboardWidget[]>(() => loadDashboardLayout(user?.id));
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<CalTask[]>([]);
  const [rfiItems, setRfiItems] = useState<CalRfi[]>([]);
  const [punchItems, setPunchItems] = useState<CalPunch[]>([]);
  const [calendarFilter, setCalendarFilter] = useState("all");

  useEffect(() => {
    setLayout(loadDashboardLayout(user?.id));
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await dbReady;
        const [clientRows, projectRows, allowed] = await Promise.all([
          db.select().from(schema.clients),
          db.select().from(schema.projects),
          getAccessibleClientIds(user),
        ]);
        const allClients = clientRows as Client[];
        let allProjects = projectRows as Project[];
        if (user && (user.is_admin === 1 || user.user_type === "internal")) {
          allProjects = await ensureProjectColors(allProjects).catch(() => allProjects);
        }
        const visibleClients = allowed ? allClients.filter((c) => allowed.includes(c.id)) : allClients;
        const visibleProjects = allowed ? allProjects.filter((p) => allowed.includes(p.client_id)) : allProjects;
        const projectIds = visibleProjects.map((p) => p.id);
        const moneyProjects = await withProjectMoney(visibleProjects);

        let eventRows: CalEvent[] = [];
        let taskRows: CalTask[] = [];
        let rfiDue: CalRfi[] = [];
        let punchDue: CalPunch[] = [];
        if (projectIds.length) {
          const [rfiRows, punchRows, eventResult, taskResult] = await Promise.all([
            db.select().from(schema.rfis).where(inArray(schema.rfis.project_id, projectIds)),
            db.select().from(schema.punch_items).where(inArray(schema.punch_items.project_id, projectIds)),
            db.select().from(schema.calendar_events).where(inArray(schema.calendar_events.project_id, projectIds)),
            db.select().from(schema.project_tasks).where(inArray(schema.project_tasks.project_id, projectIds)),
          ]);
          eventRows = eventResult as CalEvent[];
          taskRows = taskResult as CalTask[];
          rfiDue = rfiRows as CalRfi[];
          punchDue = punchRows as CalPunch[];
        }

        if (!cancelled) {
          setClients(visibleClients);
          setProjects(moneyProjects);
          setEvents(eventRows);
          setTasks(taskRows);
          setRfiItems(rfiDue);
          setPunchItems(punchDue);
        }
      } catch (err) {
        console.error("dashboard load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  function persist(next: DashboardWidget[]) {
    setLayout(next);
    saveDashboardLayout(next, user?.id);
  }

  function moveWidget(id: DashboardWidgetId, dir: -1 | 1) {
    const index = layout.findIndex((w) => w.id === id);
    const nextIndex = index + dir;
    if (index < 0 || nextIndex < 0 || nextIndex >= layout.length) return;
    const next = [...layout];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    persist(next);
  }

  function toggleWidget(id: DashboardWidgetId) {
    persist(layout.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
  }

  const widgets = useMemo(() => (editing ? layout : layout.filter((w) => w.visible)), [editing, layout]);
  if (loading) return <PageSkeleton />;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t("dash.greeting.morning");
    if (h < 17) return t("dash.greeting.afternoon");
    return t("dash.greeting.evening");
  })();

  function renderWidget(id: DashboardWidgetId) {
    if (id === "calendar") {
      const filteredProjects = calendarFilter === "all" ? projects : projects.filter((p) => String(p.id) === calendarFilter);
      const marks = marksFromPortfolio(
        filteredProjects,
        events.filter((e) => filteredProjects.some((p) => p.id === e.project_id)),
        tasks.filter((e) => filteredProjects.some((p) => p.id === e.project_id)),
        rfiItems.filter((e) => filteredProjects.some((p) => p.id === e.project_id)),
        punchItems.filter((e) => filteredProjects.some((p) => p.id === e.project_id)),
      );
      return (
        <Card className="gap-4 p-5">
          <div className="flex flex-wrap items-end justify-end gap-3">
            <Select value={calendarFilter} onValueChange={setCalendarFilter}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("dash.calendarAll")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PortfolioCalendar marks={marks} projects={filteredProjects} />
        </Card>
      );
    }

    if (id === "gantt") return <PortfolioGantt projects={projects} clients={clients} tasks={tasks} />;

    return null;
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("dash.eyebrow")}
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <Button variant="outline" onClick={() => persist(DEFAULT_DASHBOARD)}>
                {t("dash.reset")}
              </Button>
            ) : can("clients", "create") ? (
              <Button asChild>
                <Link to="/clients">
                  {t("dash.newClient")}
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            ) : null}
            <Button variant={editing ? "default" : "outline"} onClick={() => setEditing((v) => !v)}>
              {editing ? <LayoutDashboard className="size-4" /> : <Settings2 className="size-4" />}
              {editing ? t("dash.done") : t("dash.customize")}
            </Button>
          </div>
        }
      />
      <DailySummary
        userId={user?.id}
        projects={projects}
        clients={clients}
        tasks={tasks}
        dated={[
          ...events.map((e) => ({ project_id: e.project_id, title: e.title, date: e.event_date })),
          ...tasks.filter((x) => x.end_date && x.status !== "completed").map((x) => ({ project_id: x.project_id, title: x.title, date: x.end_date! })),
          ...rfiItems.filter((x) => x.due_date).map((x) => ({ project_id: x.project_id, title: x.title, date: x.due_date! })),
          ...punchItems.filter((x) => x.due_date).map((x) => ({ project_id: x.project_id, title: x.title, date: x.due_date! })),
        ]}
      />
      <div className="grid gap-6">
        {widgets.map((widget, index) => (
          <section key={widget.id} className={editing ? "rounded-sm border border-dashed border-border p-3" : undefined}>
            {editing ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{t(`dash.widget.${widget.id}` as MessageKey)}</p>
                <div className="flex gap-1">
                  <Button type="button" size="icon" variant="ghost" disabled={index === 0} onClick={() => moveWidget(widget.id, -1)} aria-label={t("dash.moveUp")}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" disabled={index === widgets.length - 1} onClick={() => moveWidget(widget.id, 1)} aria-label={t("dash.moveDown")}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => toggleWidget(widget.id)}>
                    {widget.visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {widget.visible ? t("dash.hide") : t("dash.show")}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className={editing && !widget.visible ? "pointer-events-none opacity-40" : undefined}>{renderWidget(widget.id)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
