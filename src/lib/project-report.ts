import type { Client, CompanyProfile, Locale, Project, User } from "./types";
import { formatDate, money, percent, todayISO } from "./format";

export type ReportSectionId =
  | "snapshot"
  | "schedule"
  | "budget"
  | "rfis"
  | "changes"
  | "punch"
  | "safety"
  | "logs"
  | "team"
  | "labour"
  | "portfolio";

export const REPORT_SECTIONS: { id: ReportSectionId; labelKey: string }[] = [
  { id: "snapshot", labelKey: "reports.sec.snapshot" },
  { id: "schedule", labelKey: "reports.sec.schedule" },
  { id: "budget", labelKey: "reports.sec.budget" },
  { id: "rfis", labelKey: "reports.sec.rfis" },
  { id: "changes", labelKey: "reports.sec.changes" },
  { id: "punch", labelKey: "reports.sec.punch" },
  { id: "safety", labelKey: "reports.sec.safety" },
  { id: "logs", labelKey: "reports.sec.logs" },
  { id: "team", labelKey: "reports.sec.team" },
  { id: "labour", labelKey: "reports.sec.labour" },
  { id: "portfolio", labelKey: "reports.sec.portfolio" },
];

export type ReportKind = "status" | "cost" | "closeout" | "safety" | "labour" | "portfolio" | "full" | "custom";

export const STANDARD_REPORTS: {
  id: Exclude<ReportKind, "custom">;
  titleKey: string;
  sections: ReportSectionId[];
}[] = [
  {
    id: "status",
    titleKey: "reports.std.status",
    sections: ["snapshot", "schedule", "rfis", "punch", "logs"],
  },
  {
    id: "cost",
    titleKey: "reports.std.cost",
    sections: ["snapshot", "budget", "changes"],
  },
  {
    id: "closeout",
    titleKey: "reports.std.closeout",
    sections: ["snapshot", "punch", "rfis", "changes", "team"],
  },
  {
    id: "safety",
    titleKey: "reports.std.safety",
    sections: ["snapshot", "safety", "logs"],
  },
  {
    id: "labour",
    titleKey: "reports.std.labour",
    sections: ["snapshot", "labour", "team", "logs"],
  },
  {
    id: "portfolio",
    titleKey: "reports.std.portfolio",
    sections: ["portfolio", "snapshot", "budget"],
  },
  {
    id: "full",
    titleKey: "reports.std.full",
    sections: ["snapshot", "schedule", "budget", "rfis", "changes", "punch", "safety", "logs", "team", "labour", "portfolio"],
  },
];

export type ReportRow = { label: string; value: string };

export type BuiltSection = {
  id: ReportSectionId;
  title: string;
  summary: string;
  rows: ReportRow[];
};

export type ReportPack = {
  tasks: { title: string; status: string; priority: string; start_date: string | null; end_date: string | null; assigned_to: number | null }[];
  budget: { category: string; description: string; estimated: number; actual: number; status: string }[];
  rfis: { number: string; title: string; status: string; due_date: string | null }[];
  changes: { number: string; title: string; amount: number; status: string }[];
  punch: { title: string; location: string | null; status: string; priority: string; due_date: string | null }[];
  incidents: { title: string; incident_date: string; severity: string; status: string }[];
  logs: { log_date: string; weather: string | null; crew_count: number; notes: string | null }[];
  members: { user_id: number; role: string }[];
  people: User[];
  labour: { name: string; minutes: number; job: string }[];
  portfolio: { name: string; number: string; client: string; status: string; budget: number; spent: number }[];
};

export type BuiltReport = {
  title: string;
  preparedOn: string;
  preparedBy: string;
  company: CompanyProfile;
  client: Client | null;
  project: Project;
  sections: BuiltSection[];
};

function nameOf(people: User[], id: number | null) {
  if (!id) return "—";
  return people.find((p) => p.id === id)?.name ?? "—";
}

export function buildReport(opts: {
  title: string;
  sections: ReportSectionId[];
  project: Project;
  client: Client | null;
  company: CompanyProfile;
  pack: ReportPack;
  locale: Locale;
  preparedBy: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): BuiltReport {
  const { project, pack, locale, t } = opts;
  const used = percent(project.spent, project.budget);
  const openRfi = pack.rfis.filter((r) => r.status === "open").length;
  const openPunch = pack.punch.filter((p) => p.status !== "complete").length;
  const openSafety = pack.incidents.filter((s) => s.status !== "closed").length;
  const inFlight = pack.tasks.filter((x) => x.status !== "done" && x.status !== "complete").length;
  const est = pack.budget.reduce((s, i) => s + i.estimated, 0);
  const act = pack.budget.reduce((s, i) => s + i.actual, 0);
  const coSum = pack.changes.reduce((s, i) => s + i.amount, 0);

  const builders: Record<ReportSectionId, () => BuiltSection> = {
    snapshot: () => ({
      id: "snapshot",
      title: t("reports.sec.snapshot"),
      summary: t("reports.snap.summary", {
        status: project.status,
        phase: project.phase,
        used,
      }),
      rows: [
        { label: t("reports.snap.number"), value: project.project_number },
        { label: t("reports.snap.client"), value: opts.client?.company_name ?? "—" },
        { label: t("reports.snap.city"), value: project.city ?? "—" },
        { label: t("reports.snap.window"), value: `${formatDate(project.start_date, locale)} → ${formatDate(project.end_date, locale)}` },
        { label: t("reports.snap.budget"), value: money(project.budget, locale) },
        { label: t("reports.snap.spent"), value: `${money(project.spent, locale)} (${used}%)` },
        { label: t("reports.snap.tasks"), value: String(inFlight) },
        { label: t("reports.snap.rfis"), value: String(openRfi) },
        { label: t("reports.snap.punch"), value: String(openPunch) },
      ],
    }),
    schedule: () => ({
      id: "schedule",
      title: t("reports.sec.schedule"),
      summary: t("reports.sched.summary", { n: pack.tasks.length, open: inFlight }),
      rows: pack.tasks.slice(0, 18).map((task) => ({
        label: task.title,
        value: `${task.status} · ${formatDate(task.start_date, locale)} → ${formatDate(task.end_date, locale)} · ${nameOf(pack.people, task.assigned_to)}`,
      })),
    }),
    budget: () => ({
      id: "budget",
      title: t("reports.sec.budget"),
      summary: t("reports.budget.summary", {
        est: money(est || project.budget, locale),
        act: money(act, locale),
      }),
      rows: pack.budget.slice(0, 18).map((line) => ({
        label: `${line.category} · ${line.description}`,
        value: `${money(line.actual, locale)} / ${money(line.estimated, locale)} · ${line.status}`,
      })),
    }),
    rfis: () => ({
      id: "rfis",
      title: t("reports.sec.rfis"),
      summary: t("reports.rfis.summary", { n: pack.rfis.length, open: openRfi }),
      rows: pack.rfis.slice(0, 18).map((r) => ({
        label: `${r.number} · ${r.title}`,
        value: `${r.status} · ${formatDate(r.due_date, locale)}`,
      })),
    }),
    changes: () => ({
      id: "changes",
      title: t("reports.sec.changes"),
      summary: t("reports.changes.summary", { n: pack.changes.length, amount: money(coSum, locale) }),
      rows: pack.changes.slice(0, 18).map((c) => ({
        label: `${c.number} · ${c.title}`,
        value: `${money(c.amount, locale)} · ${c.status}`,
      })),
    }),
    punch: () => ({
      id: "punch",
      title: t("reports.sec.punch"),
      summary: t("reports.punch.summary", { n: pack.punch.length, open: openPunch }),
      rows: pack.punch.slice(0, 18).map((p) => ({
        label: p.title,
        value: `${p.status} · ${p.priority}${p.location ? ` · ${p.location}` : ""}`,
      })),
    }),
    safety: () => ({
      id: "safety",
      title: t("reports.sec.safety"),
      summary: t("reports.safety.summary", { n: pack.incidents.length, open: openSafety }),
      rows: pack.incidents.slice(0, 18).map((s) => ({
        label: s.title,
        value: `${formatDate(s.incident_date, locale)} · ${s.severity} · ${s.status}`,
      })),
    }),
    logs: () => ({
      id: "logs",
      title: t("reports.sec.logs"),
      summary: t("reports.logs.summary", { n: pack.logs.length }),
      rows: [...pack.logs]
        .sort((a, b) => b.log_date.localeCompare(a.log_date))
        .slice(0, 12)
        .map((l) => ({
          label: formatDate(l.log_date, locale),
          value: `${l.weather ?? "—"} · ${l.crew_count} · ${l.notes ?? ""}`.trim(),
        })),
    }),
    team: () => ({
      id: "team",
      title: t("reports.sec.team"),
      summary: t("reports.team.summary", { n: pack.members.length }),
      rows: pack.members.map((m) => ({
        label: nameOf(pack.people, m.user_id),
        value: m.role,
      })),
    }),
    labour: () => {
      const total = pack.labour.reduce((s, row) => s + row.minutes, 0);
      const hours = Math.round(total / 60);
      return {
        id: "labour",
        title: t("reports.sec.labour"),
        summary: t("reports.labour.summary", { n: pack.labour.length, hours }),
        rows: pack.labour.slice(0, 24).map((row) => ({
          label: `${row.name} · ${row.job}`,
          value: `${Math.floor(row.minutes / 60)}h ${String(row.minutes % 60).padStart(2, "0")}m`,
        })),
      };
    },
    portfolio: () => ({
      id: "portfolio",
      title: t("reports.sec.portfolio"),
      summary: t("reports.portfolio.summary", { n: pack.portfolio.length }),
      rows: pack.portfolio.slice(0, 24).map((job) => ({
        label: `${job.number} · ${job.name}`,
        value: `${job.client} · ${job.status} · ${money(job.spent, locale)} / ${money(job.budget, locale)}`,
      })),
    }),
  };

  return {
    title: opts.title,
    preparedOn: todayISO(),
    preparedBy: opts.preparedBy,
    company: opts.company,
    client: opts.client,
    project,
    sections: opts.sections.map((id) => builders[id]()),
  };
}
