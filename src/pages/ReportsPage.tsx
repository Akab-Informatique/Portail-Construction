import { useMemo, useState } from "react";
import { Download, Presentation } from "lucide-react";
import { inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { getCompanyProfile } from "@/lib/settings";
import { pairPunches } from "@/lib/timeclock";
import { downloadReportPdf } from "@/lib/report-pdf";
import {
  STANDARD_REPORTS,
  buildReport,
  type ReportKind,
  type ReportPack,
  type ReportSectionId,
} from "@/lib/project-report";
import type { Client, Project, TimePunch, User } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function emptyPack(): ReportPack {
  return {
    tasks: [],
    budget: [],
    rfis: [],
    changes: [],
    punch: [],
    incidents: [],
    logs: [],
    members: [],
    people: [],
    labour: [],
    portfolio: [],
  };
}

async function loadPack(projectIds: number[], clients: Client[], projects: Project[]): Promise<ReportPack> {
  await dbReady;
  if (projectIds.length === 0) return emptyPack();
  const people = (await db.select().from(schema.users)) as User[];
  const [tasks, budget, rfis, changes, punch, incidents, logs, members, punches] = await Promise.all([
    db.select().from(schema.project_tasks).where(inArray(schema.project_tasks.project_id, projectIds)),
    db.select().from(schema.budget_items).where(inArray(schema.budget_items.project_id, projectIds)),
    db.select().from(schema.rfis).where(inArray(schema.rfis.project_id, projectIds)),
    db.select().from(schema.change_orders).where(inArray(schema.change_orders.project_id, projectIds)),
    db.select().from(schema.punch_items).where(inArray(schema.punch_items.project_id, projectIds)),
    db.select().from(schema.safety_incidents).where(inArray(schema.safety_incidents.project_id, projectIds)),
    db.select().from(schema.daily_logs).where(inArray(schema.daily_logs.project_id, projectIds)),
    db.select().from(schema.project_members).where(inArray(schema.project_members.project_id, projectIds)),
    db.select().from(schema.time_punches).where(inArray(schema.time_punches.project_id, projectIds)),
  ]);

  const labourMap = new Map<string, { name: string; minutes: number; job: string }>();
  for (const projectId of projectIds) {
    const job = projects.find((p) => p.id === projectId);
    const entries = pairPunches((punches as TimePunch[]).filter((p) => p.project_id === projectId));
    for (const entry of entries) {
      const person = people.find((u) => u.id === entry.punchIn.user_id);
      const key = `${entry.punchIn.user_id}:${projectId}`;
      const prev = labourMap.get(key);
      const minutes = (prev?.minutes ?? 0) + entry.minutes;
      labourMap.set(key, {
        name: person?.name ?? `#${entry.punchIn.user_id}`,
        minutes,
        job: job?.name ?? String(projectId),
      });
    }
  }

  return {
    tasks: tasks as ReportPack["tasks"],
    budget: budget as ReportPack["budget"],
    rfis: rfis as ReportPack["rfis"],
    changes: changes as ReportPack["changes"],
    punch: punch as ReportPack["punch"],
    incidents: incidents as ReportPack["incidents"],
    logs: logs as ReportPack["logs"],
    members: members as ReportPack["members"],
    people,
    labour: [...labourMap.values()].sort((a, b) => b.minutes - a.minutes),
    portfolio: projects
      .filter((p) => projectIds.includes(p.id))
      .map((p) => ({
        name: p.name,
        number: p.project_number,
        client: clients.find((c) => c.id === p.client_id)?.company_name ?? "—",
        status: p.status,
        budget: p.budget,
        spent: p.spent,
      })),
  };
}

export function ReportsPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { projects, clients, selectedClient, clientProjects } = useWorkspace();
  const jobs = selectedClient ? clientProjects : projects;
  const [jobId, setJobId] = useState<string>("all");
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const asClient = user?.user_type === "external" || user?.view_as === "client";
  const isAdmin = Boolean(user?.is_admin) && !asClient;
  // Staff get the reports without money: the status, safety and labour reports of the projects they work on.
  const allowed = isAdmin || (user?.user_type === "internal" && !asClient);
  const reports = isAdmin ? STANDARD_REPORTS : STANDARD_REPORTS.filter((r) => ["status", "safety", "labour"].includes(r.id));

  const selectedJobs = useMemo(() => {
    if (jobId === "all") return jobs;
    const one = jobs.find((p) => String(p.id) === jobId);
    return one ? [one] : jobs;
  }, [jobId, jobs]);

  async function exportKind(kind: (typeof STANDARD_REPORTS)[number]) {
    if (selectedJobs.length === 0) return;
    setBusy(kind.id);
    try {
      const company = await getCompanyProfile();
      const pack = await loadPack(
        selectedJobs.map((p) => p.id),
        clients,
        jobs,
      );
      const primary = selectedJobs[0];
      const client = clients.find((c) => c.id === primary.client_id) ?? null;
      const title = t(kind.titleKey as never);
      const report = buildReport({
        title,
        sections: kind.sections as ReportSectionId[],
        project:
          selectedJobs.length === 1
            ? primary
            : {
                ...primary,
                name: t("reports.hub.allJobs"),
                project_number: selectedClient?.company_name ?? t("reports.hub.allJobs"),
                description: t("reports.portfolio.summary", { n: selectedJobs.length }),
              },
        client: selectedJobs.length === 1 ? client : selectedClient,
        company,
        pack,
        locale,
        preparedBy: user?.name ?? "",
        noMoney: !isAdmin,
        t: (key, vars) => t(key as never, vars as never),
      });
      downloadReportPdf(report, locale);
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) {
    return (
      <EmptyState
        icon={<Presentation className="size-5" />}
        title={t("reports.hub.title")}
        description={t("reports.noCreate")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("reports.hub.title")} />
      {jobs.length === 0 ? (
        <EmptyState icon={<Presentation className="size-5" />} title={t("reports.hub.empty")} description={t("reports.hub.hint")} />
      ) : (
        <>
          <Card className="max-w-xl gap-3 p-4">
            <Label>{t("reports.hub.pickJob")}</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reports.hub.allJobs")}</SelectItem>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={String(job.id)}>
                    {job.project_number} · {job.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((kind) => (
              <Card key={kind.id} className="gap-4 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("reports.standard")}
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">{t(kind.titleKey as never)}</h2>
                </div>
                <Button
                  onClick={() => void exportKind(kind)}
                  disabled={busy !== null}
                >
                  <Download className="size-4" />
                  {busy === kind.id ? t("reports.hub.busy") : t("reports.hub.export")}
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
