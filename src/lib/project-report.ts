import { inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import type { Client, CompanyProfile, Locale, Project, TimePunch, User } from "./types";
import { formatDate, money, todayISO } from "./format";
import { pairPunches } from "./timeclock";
import { projectAchievement } from "./project-progress";

export type ReportSectionId =
  | "snapshot"
  | "schedule"
  | "rfis"
  | "punch"
  | "safety"
  | "logs"
  | "team"
  | "labour"
  | "qrt"
  | "notes"
  | "forms"
  | "budget"
  | "changes"
  | "portfolio";

/**
 * Every chapter a report can hold. `money` chapters carry amounts and are granted separately.
 * Each chapter is read only from what the person can already see: the database limits projects, clients and rows.
 */
export const REPORT_SECTIONS: { id: ReportSectionId; labelKey: string; money?: boolean }[] = [
  { id: "snapshot", labelKey: "reports.sec.snapshot" },
  { id: "schedule", labelKey: "reports.sec.schedule" },
  { id: "rfis", labelKey: "reports.sec.rfis" },
  { id: "punch", labelKey: "reports.sec.punch" },
  { id: "safety", labelKey: "reports.sec.safety" },
  { id: "logs", labelKey: "reports.sec.logs" },
  { id: "team", labelKey: "reports.sec.team" },
  { id: "labour", labelKey: "reports.sec.labour" },
  { id: "qrt", labelKey: "reports.sec.qrt" },
  { id: "notes", labelKey: "reports.sec.notes" },
  { id: "forms", labelKey: "reports.sec.forms" },
  { id: "budget", labelKey: "reports.sec.budget", money: true },
  { id: "changes", labelKey: "reports.sec.changes", money: true },
  { id: "portfolio", labelKey: "reports.sec.portfolio", money: true },
];

export type ReportKind = "status" | "cost" | "closeout" | "safety" | "labour" | "portfolio" | "full" | "custom";

export const STANDARD_REPORTS: {
  id: Exclude<ReportKind, "custom">;
  titleKey: string;
  sections: ReportSectionId[];
}[] = [
  { id: "status", titleKey: "reports.std.status", sections: ["snapshot", "schedule", "rfis", "punch", "logs"] },
  { id: "cost", titleKey: "reports.std.cost", sections: ["snapshot", "budget", "changes"] },
  { id: "closeout", titleKey: "reports.std.closeout", sections: ["snapshot", "punch", "rfis", "changes", "team"] },
  { id: "safety", titleKey: "reports.std.safety", sections: ["snapshot", "safety", "logs"] },
  { id: "labour", titleKey: "reports.std.labour", sections: ["snapshot", "labour", "team", "logs"] },
  { id: "portfolio", titleKey: "reports.std.portfolio", sections: ["portfolio", "snapshot", "budget"] },
  { id: "full", titleKey: "reports.std.full", sections: ["snapshot", "schedule", "budget", "rfis", "changes", "punch", "safety", "logs", "team", "labour", "portfolio"] },
];

export type ReportRow = { label: string; value: string };

export type BuiltSection = {
  id: ReportSectionId;
  title: string;
  summary: string;
  rows: ReportRow[];
};

export type BuiltReport = {
  title: string;
  preparedOn: string;
  preparedBy: string;
  company: CompanyProfile;
  client: Client | null;
  /** The first selected project (address, number); the cover uses `scopeLabel` / `scopeNumber` for the whole selection. */
  project: Project;
  scopeLabel: string;
  scopeNumber: string;
  /** The period the report covers (YYYY-MM-DD); null = no limit on that side. */
  period: { from: string | null; to: string | null };
  sections: BuiltSection[];
};

const ROW_LIMIT = 80;

/** A day (YYYY-MM-DD) out of a date, a timestamp or a Date. */
function dayOf(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return "";
}

/**
 * Builds a report from what the signed-in person can read. Only the chapters asked for are read, only for the chosen
 * projects, and only inside the chosen period.
 */
export async function buildReport(opts: {
  title: string;
  sections: ReportSectionId[];
  projects: Project[];
  clients: Client[];
  company: CompanyProfile;
  locale: Locale;
  preparedBy: string;
  from: string | null;
  to: string | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<BuiltReport> {
  await dbReady;
  const { projects, locale, t } = opts;
  const { from, to } = opts;
  const ids = projects.map((p) => p.id);
  const multi = projects.length > 1;
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const pre = (projectId: number) => (multi ? `${nameOf.get(projectId) ?? projectId} · ` : "");
  const within = (value: unknown) => {
    if (!from && !to) return true;
    const d = dayOf(value);
    if (!d) return false;
    return (!from || d >= from) && (!to || d <= to);
  };
  /** A span (task start/end) touches the period. */
  const overlaps = (start: unknown, end: unknown) => {
    if (!from && !to) return true;
    const s = dayOf(start) || dayOf(end);
    const e = dayOf(end) || dayOf(start);
    if (!s || !e) return false;
    return (!to || s <= to) && (!from || e >= from);
  };
  const want = new Set(opts.sections);
  const people = ids.length && (want.has("team") || want.has("schedule") || want.has("labour") || want.has("notes") || want.has("forms") || want.has("qrt")) ? ((await db.select().from(schema.users)) as User[]) : [];
  const person = (id: number | null) => (id ? people.find((p) => p.id === id)?.name ?? "—" : "—");
  const only = <T extends { project_id: number }>(rows: T[]) => rows.filter((r) => ids.includes(r.project_id));
  const clip = (text: string, n = 160) => (text.length > n ? `${text.slice(0, n)}…` : text);

  const built: Record<string, () => Promise<BuiltSection> | BuiltSection> = {
    snapshot: async () => {
      const tasks = await db.select().from(schema.project_tasks).where(inArray(schema.project_tasks.project_id, ids));
      const moneyOn = want.has("budget") || want.has("portfolio") || want.has("changes");
      const rows: ReportRow[] = projects.map((p) => {
        const mine = tasks.filter((x) => x.project_id === p.id && x.kind === "task");
        const a = projectAchievement(p, mine.map((x) => ({ project_id: x.project_id, status: x.status })));
        const open = mine.filter((x) => x.status !== "completed").length;
        const client = opts.clients.find((c) => c.id === p.client_id)?.company_name ?? "—";
        const parts = [`${client}`, `${p.status} · ${p.phase}`, `${a.percent} %`, `${formatDate(p.start_date, locale)} → ${formatDate(p.end_date, locale)}`, t("reports.snap.openTasks", { n: open })];
        if (moneyOn) parts.push(`${money(p.spent, locale)} / ${money(p.budget, locale)}`);
        return { label: `${p.project_number} · ${p.name}`, value: parts.join(" · ") };
      });
      return { id: "snapshot", title: t("reports.sec.snapshot"), summary: t("reports.snap.summary2", { n: projects.length }), rows };
    },
    schedule: async () => {
      const rows = only(await db.select().from(schema.project_tasks).where(inArray(schema.project_tasks.project_id, ids))).filter((x) => x.kind === "task" && overlaps(x.start_date, x.end_date));
      const open = rows.filter((x) => x.status !== "completed").length;
      return {
        id: "schedule",
        title: t("reports.sec.schedule"),
        summary: t("reports.sched.summary", { n: rows.length, open }),
        rows: rows.slice(0, ROW_LIMIT).map((x) => ({ label: `${pre(x.project_id)}${x.title}`, value: `${x.status.replace(/_/g, " ")} · ${formatDate(x.start_date, locale)} → ${formatDate(x.end_date, locale)} · ${person(x.assigned_to)}` })),
      };
    },
    rfis: async () => {
      const rows = only(await db.select().from(schema.rfis).where(inArray(schema.rfis.project_id, ids))).filter((r) => within(r.due_date) || within(r.created_at));
      return {
        id: "rfis",
        title: t("reports.sec.rfis"),
        summary: t("reports.rfis.summary", { n: rows.length, open: rows.filter((r) => r.status === "open").length }),
        rows: rows.slice(0, ROW_LIMIT).map((r) => ({ label: `${pre(r.project_id)}${r.number} · ${r.title}`, value: `${r.status} · ${formatDate(r.due_date, locale)}` })),
      };
    },
    punch: async () => {
      const rows = only(await db.select().from(schema.punch_items).where(inArray(schema.punch_items.project_id, ids))).filter((p) => within(p.due_date) || within(p.created_at));
      return {
        id: "punch",
        title: t("reports.sec.punch"),
        summary: t("reports.punch.summary", { n: rows.length, open: rows.filter((p) => p.status !== "complete").length }),
        rows: rows.slice(0, ROW_LIMIT).map((p) => ({ label: `${pre(p.project_id)}${p.title}`, value: `${p.status} · ${p.priority}${p.location ? ` · ${p.location}` : ""}` })),
      };
    },
    safety: async () => {
      const rows = only(await db.select().from(schema.safety_incidents).where(inArray(schema.safety_incidents.project_id, ids))).filter((s) => within(s.incident_date));
      return {
        id: "safety",
        title: t("reports.sec.safety"),
        summary: t("reports.safety.summary", { n: rows.length, open: rows.filter((s) => s.status !== "closed").length }),
        rows: rows.slice(0, ROW_LIMIT).map((s) => ({ label: `${pre(s.project_id)}${s.title}`, value: `${formatDate(s.incident_date, locale)} · ${s.severity} · ${s.status}` })),
      };
    },
    logs: async () => {
      const rows = only(await db.select().from(schema.daily_logs).where(inArray(schema.daily_logs.project_id, ids))).filter((l) => within(l.log_date));
      return {
        id: "logs",
        title: t("reports.sec.logs"),
        summary: t("reports.logs.summary", { n: rows.length }),
        rows: [...rows]
          .sort((a, b) => b.log_date.localeCompare(a.log_date))
          .slice(0, ROW_LIMIT)
          .map((l) => ({ label: `${pre(l.project_id)}${formatDate(l.log_date, locale)}`, value: `${l.weather ?? "—"} · ${l.crew_count} · ${l.notes ?? ""}`.trim() })),
      };
    },
    team: async () => {
      const rows = only(await db.select().from(schema.project_members).where(inArray(schema.project_members.project_id, ids)));
      return { id: "team", title: t("reports.sec.team"), summary: t("reports.team.summary", { n: rows.length }), rows: rows.map((m) => ({ label: `${pre(m.project_id)}${person(m.user_id)}`, value: m.role })) };
    },
    labour: async () => {
      const punches = (only(await db.select().from(schema.time_punches).where(inArray(schema.time_punches.project_id, ids))) as TimePunch[]).filter((p) => within(p.punched_at));
      const totals = new Map<string, { name: string; minutes: number; job: string }>();
      for (const projectId of ids) {
        for (const entry of pairPunches(punches.filter((p) => p.project_id === projectId))) {
          const key = `${entry.punchIn.user_id}:${projectId}`;
          const prev = totals.get(key);
          totals.set(key, { name: person(entry.punchIn.user_id), job: nameOf.get(projectId) ?? String(projectId), minutes: (prev?.minutes ?? 0) + entry.minutes });
        }
      }
      const list = [...totals.values()].sort((a, b) => b.minutes - a.minutes);
      const hours = Math.round(list.reduce((s, r) => s + r.minutes, 0) / 60);
      return {
        id: "labour",
        title: t("reports.sec.labour"),
        summary: t("reports.labour.summary", { n: list.length, hours }),
        rows: list.slice(0, ROW_LIMIT).map((r) => ({ label: `${r.name} · ${r.job}`, value: `${Math.floor(r.minutes / 60)}h ${String(r.minutes % 60).padStart(2, "0")}m` })),
      };
    },
    qrt: async () => {
      const rows = only(await db.select().from(schema.project_qrt).where(inArray(schema.project_qrt.project_id, ids))).filter((q) => within(q.created_at));
      return {
        id: "qrt",
        title: t("reports.sec.qrt"),
        summary: t("reports.qrt.summary", { n: rows.length, open: rows.filter((q) => q.status === "open").length }),
        rows: rows.slice(0, ROW_LIMIT).map((q) => ({ label: `${pre(q.project_id)}${clip(q.question, 110)}`, value: q.answer ? clip(q.answer) : t("qrt.waiting") })),
      };
    },
    notes: async () => {
      const rows = only(await db.select().from(schema.project_notes).where(inArray(schema.project_notes.project_id, ids))).filter((n) => n.auto === 0 && n.visibility !== "admin" && within(n.created_at));
      return {
        id: "notes",
        title: t("reports.sec.notes"),
        summary: t("reports.notes.summary", { n: rows.length }),
        rows: rows.slice(0, ROW_LIMIT).map((n) => ({ label: `${pre(n.project_id)}${person(n.user_id)} · ${formatDate(dayOf(n.created_at), locale)}`, value: clip(n.body, 200) })),
      };
    },
    forms: async () => {
      const rows = only(await db.select().from(schema.form_entries).where(inArray(schema.form_entries.project_id, ids))).filter((f) => within(f.entry_date));
      return {
        id: "forms",
        title: t("reports.sec.forms"),
        summary: t("reports.forms.summary", { n: rows.length }),
        rows: rows.slice(0, ROW_LIMIT).map((f) => ({ label: `${pre(f.project_id)}${f.template_name}`, value: `${formatDate(f.entry_date, locale)} · ${person(f.created_by)}` })),
      };
    },
    budget: async () => {
      const rows = only(await db.select().from(schema.budget_items).where(inArray(schema.budget_items.project_id, ids)));
      const est = rows.reduce((s, i) => s + i.estimated, 0);
      const act = rows.reduce((s, i) => s + i.actual, 0);
      return {
        id: "budget",
        title: t("reports.sec.budget"),
        summary: t("reports.budget.summary", { est: money(est || projects.reduce((s, p) => s + p.budget, 0), locale), act: money(act, locale) }),
        rows: rows.slice(0, ROW_LIMIT).map((l) => ({ label: `${pre(l.project_id)}${l.category} · ${l.description}`, value: `${money(l.actual, locale)} / ${money(l.estimated, locale)} · ${l.status}` })),
      };
    },
    changes: async () => {
      const rows = only(await db.select().from(schema.change_orders).where(inArray(schema.change_orders.project_id, ids))).filter((c) => within(c.created_at));
      return {
        id: "changes",
        title: t("reports.sec.changes"),
        summary: t("reports.changes.summary", { n: rows.length, amount: money(rows.reduce((s, c) => s + c.amount, 0), locale) }),
        rows: rows.slice(0, ROW_LIMIT).map((c) => ({ label: `${pre(c.project_id)}${c.number} · ${c.title}`, value: `${money(c.amount, locale)} · ${c.status}` })),
      };
    },
    portfolio: () => ({
      id: "portfolio",
      title: t("reports.sec.portfolio"),
      summary: t("reports.portfolio.summary", { n: projects.length }),
      rows: projects.map((p) => ({ label: `${p.project_number} · ${p.name}`, value: `${opts.clients.find((c) => c.id === p.client_id)?.company_name ?? "—"} · ${p.status} · ${money(p.spent, locale)} / ${money(p.budget, locale)}` })),
    }),
  };

  const sections: BuiltSection[] = [];
  for (const id of opts.sections) {
    if (!ids.length) break;
    sections.push(await built[id]());
  }

  const first = projects[0];
  const clientIds = [...new Set(projects.map((p) => p.client_id))];
  return {
    title: opts.title,
    preparedOn: todayISO(),
    preparedBy: opts.preparedBy,
    company: opts.company,
    client: clientIds.length === 1 ? opts.clients.find((c) => c.id === clientIds[0]) ?? null : null,
    project: first,
    scopeLabel: multi ? t("reports.scope.many", { n: projects.length }) : first.name,
    scopeNumber: multi ? "" : first.project_number,
    period: { from, to },
    sections,
  };
}
