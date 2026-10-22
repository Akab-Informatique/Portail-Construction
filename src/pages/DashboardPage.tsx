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
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortfolioCalendar, PortfolioGantt, marksFromPortfolio } from "@/components/PortfolioCalendar";
import { money, percent } from "@/lib/format";
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
type CalTask = { id: number; end_date: string | null; title: string; project_id: number };
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
        const allProjects = projectRows as Project[];
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
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("dash.calendarFilter")}</p>
              <p className="text-xs text-muted-foreground">{t("dash.ganttHint")}</p>
            </div>
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
          <PortfolioCalendar marks={marks} />
        </Card>
      );
    }

    if (id === "gantt") return <PortfolioGantt projects={projects} />;

    if (id === "projects") {
      return (
        <Card className="py-0">
          <CardHeader className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t("dash.projects")}</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/projects">{t("dash.viewAll")}</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {projects.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("dash.noProjects")}</p>
            ) : (
              <ul className="divide-y">
                {projects.slice(0, 6).map((p) => {
                  const client = clients.find((c) => c.id === p.client_id);
                  const used = percent(p.spent, p.budget);
                  return (
                    <li key={p.id}>
                      <Link to={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium">{p.name}</p>
                            <StatusBadge value={p.status} />
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {p.project_number} · {client?.company_name ?? "—"} · {p.city}
                          </p>
                        </div>
                        <div className="hidden w-36 sm:block">
                          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                            <span className="tabular-nums">{money(p.spent)}</span>
                            <span>{used}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(used, 100)}%` }} />
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      );
    }

    return null;
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("dash.eyebrow")}
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        description={editing ? t("dash.customizeHint") : user?.user_type === "external" ? t("dash.desc.external") : t("dash.desc.internal")}
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
