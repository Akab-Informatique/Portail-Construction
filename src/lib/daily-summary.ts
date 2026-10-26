import { todayISO, formatDate } from "./format";
import { getSetting, AI_KEY } from "./settings";
import { projectAchievement, scheduleElapsed, type TaskLite } from "./project-progress";
import type { Client, Project } from "./types";

type Dated = { project_id: number; title: string; date: string };

export type SummaryFacts = {
  today: string;
  projectCount: number;
  running: number;
  overallProgressPercent: number;
  projects: {
    name: string;
    client: string;
    status: string;
    progressPercent: number;
    scheduleElapsedPercent: number;
    start: string | null;
    end: string | null;
    daysLeft: number | null;
    late: boolean;
    behindSchedule: boolean;
  }[];
  upcoming: { title: string; project: string; date: string; inDays: number }[];
};

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

/** Plain facts about the portfolio. No money: the briefing talks about progress and dates only. */
export function buildFacts(projects: Project[], clients: Client[], tasks: TaskLite[], dated: Dated[]): SummaryFacts {
  const today = todayISO();
  const rows = projects.map((p) => {
    const a = projectAchievement(p, tasks);
    const elapsed = scheduleElapsed(p.start_date, p.end_date, today);
    const daysLeft = p.end_date ? days(today, p.end_date) : null;
    const done = p.status === "completed";
    return {
      name: p.name,
      client: clients.find((c) => c.id === p.client_id)?.company_name ?? "",
      status: p.status,
      progressPercent: a.percent,
      scheduleElapsedPercent: elapsed,
      start: p.start_date,
      end: p.end_date,
      daysLeft,
      late: !done && daysLeft !== null && daysLeft < 0,
      behindSchedule: !done && p.start_date !== null && p.start_date <= today && elapsed - a.percent >= 15,
    };
  });
  const running = projects.filter((p) => p.status !== "completed");
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const upcoming = dated
    .filter((d) => d.date >= today && days(today, d.date) <= 14 && names.has(d.project_id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
    .map((d) => ({ title: d.title, project: names.get(d.project_id)!, date: d.date, inDays: days(today, d.date) }));
  const avg = running.length ? Math.round(running.reduce((s, p) => s + projectAchievement(p, tasks).percent, 0) / running.length) : 0;
  return { today, projectCount: projects.length, running: running.length, overallProgressPercent: avg, projects: rows.slice(0, 20), upcoming };
}

type T = (key: never, vars?: Record<string, string | number>) => string;

/** Same briefing without AI, used when no AI is set up or the call fails. */
export function fallbackSummary(facts: SummaryFacts, t: T, locale: string) {
  const say = (key: string, vars?: Record<string, string | number>) => (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, vars);
  if (facts.projectCount === 0) return say("dash.sum.none");
  const parts = [say("dash.sum.running", { n: facts.running, pct: facts.overallProgressPercent })];
  const late = facts.projects.filter((p) => p.late || p.behindSchedule).map((p) => p.name);
  if (late.length) parts.push(say("dash.sum.late", { names: late.slice(0, 3).join(", ") }));
  const next = facts.upcoming[0];
  if (next) parts.push(say("dash.sum.next", { title: next.title, project: next.project, date: formatDate(next.date, locale as never) }));
  return parts.join(" ");
}

const cacheKey = (userId: number | undefined, locale: string) => `frx.dailySummary.${userId ?? 0}.${locale}`;

export function readCachedSummary(userId: number | undefined, locale: string): { date: string; text: string } | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId, locale));
    const parsed = raw ? (JSON.parse(raw) as { date: string; text: string }) : null;
    return parsed && parsed.date === todayISO() && parsed.text ? parsed : null;
  } catch {
    return null;
  }
}

export function cacheSummary(userId: number | undefined, locale: string, text: string) {
  try {
    localStorage.setItem(cacheKey(userId, locale), JSON.stringify({ date: todayISO(), text }));
  } catch {
    /* storage can be unavailable */
  }
}

/** Asks the AI for the briefing. Resolves to null when no AI is set up or it fails. */
export async function fetchAiSummary(facts: unknown, locale: string, kind: "dashboard" | "project" = "dashboard"): Promise<string | null> {
  try {
    // Local development keeps its AI settings in the browser, so it sends them along; the live server uses its own.
    const ai = import.meta.env.PROD ? undefined : await getSetting(AI_KEY).then((raw) => (raw ? JSON.parse(raw) : undefined)).catch(() => undefined);
    const res = await fetch("/api/billing-files", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summary", facts, kind, language: locale === "en" ? "en" : "fr", ai }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}
