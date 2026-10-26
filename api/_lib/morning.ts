import nodemailer from "nodemailer";
import { hasDatabase, readStoredSetting, serverQuery } from "../db.ts";
import { aiConfig } from "../billing-files.ts";
import { writeSummary } from "./billing-ai.ts";
import { mergeSmtp, type Smtp } from "./smtp.ts";
import { getGraphToken, mergeSharePointConfig, type SharePointConfig } from "./sharepoint.ts";

const ZONE = "America/Toronto";
const GRAPH = "https://graph.microsoft.com/v1.0";
/** The morning email goes out from this hour on, until noon (a restart in the afternoon does not send yesterday's news). */
const FIRST_HOUR = 6;
const LAST_HOUR = 11;

export type OutlookEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string };

/** Today as YYYY-MM-DD and the hour, in the company's time zone. */
export function nowInZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

async function graphConfig(): Promise<SharePointConfig> {
  let saved: SharePointConfig = {};
  try {
    const raw = await readStoredSetting("sharepoint");
    if (raw) saved = JSON.parse(raw) as SharePointConfig;
  } catch {
    saved = {};
  }
  return mergeSharePointConfig({ ...saved, client_secret: process.env.SHAREPOINT_CLIENT_SECRET || saved.client_secret });
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The Outlook (Microsoft 365) calendar of one mailbox between two days, read with the same Microsoft app as SharePoint.
 * That app needs the "Calendars.Read" application permission. A person only ever reads their own mailbox.
 */
export async function outlookEvents(mailbox: string, from: string, to: string): Promise<{ events: OutlookEvent[] } | { error: string }> {
  const cfg = await graphConfig();
  if (!cfg.tenant_id || !cfg.client_id || !cfg.client_secret) return { error: "notConfigured" };
  try {
    const token = await getGraphToken({ ...cfg, site_url: cfg.site_url || "configured" });
    const url = `${GRAPH}/users/${encodeURIComponent(mailbox)}/calendarView?startDateTime=${from}T00:00:00&endDateTime=${addDays(to, 1)}T00:00:00&$top=200&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,isCancelled`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${ZONE}"` } });
    const json = (await res.json().catch(() => ({}))) as { value?: Record<string, any>[]; error?: { message?: string; code?: string } };
    if (!res.ok) return { error: json.error?.message || json.error?.code || `Graph ${res.status}` };
    const events = (json.value ?? [])
      .filter((e) => !e.isCancelled)
      .map((e) => {
        const allDay = Boolean(e.isAllDay);
        const start = String(e.start?.dateTime ?? "").slice(0, 16);
        let end = String(e.end?.dateTime ?? "").slice(0, 16);
        // An all-day event ends at midnight of the next day: show the last day it covers.
        if (allDay && end) end = `${addDays(end.slice(0, 10), -1)}T00:00`;
        return { id: String(e.id), title: String(e.subject || ""), start, end, allDay, location: String(e.location?.displayName ?? "") };
      });
    return { events };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "failed" };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type TaskRow = { id: number; title: string; status: string; start_date: string | null; end_date: string | null; priority: string; project: string };
type Person = { id: number; name: string; email: string; locale: string | null };

const TEXT = {
  fr: {
    paper: "LA GAZETTE FRX",
    hello: (n: string) => `Bonjour ${n}, voici ta journée.`,
    overdue: "En retard",
    today: "Aujourd’hui",
    soon: "À venir cette semaine",
    calendar: "Ton calendrier Outlook",
    nothing: "Rien de prévu : profites-en pour avancer tes dossiers.",
    until: "jusqu’au",
    allDay: "Toute la journée",
    subject: (d: string) => `La Gazette FRX — ${d}`,
    footer: "Tu reçois ce courriel parce que l’option est activée dans ton profil du portail FRX.",
  },
  en: {
    paper: "THE FRX GAZETTE",
    hello: (n: string) => `Good morning ${n}, here is your day.`,
    overdue: "Overdue",
    today: "Today",
    soon: "Coming up this week",
    calendar: "Your Outlook calendar",
    nothing: "Nothing planned: a good day to move your files forward.",
    until: "until",
    allDay: "All day",
    subject: (d: string) => `The FRX Gazette — ${d}`,
    footer: "You receive this email because it is switched on in your FRX portal profile.",
  },
};

/** The morning gazette for one person: an AI editorial (when the AI is set up) and the day's lists. */
export async function buildMorning(person: Person, prefs: { o365_calendar: number }) {
  const lang = person.locale === "en" ? "en" : "fr";
  const L = TEXT[lang];
  const { day } = nowInZone();
  const weekEnd = addDays(day, 7);

  const tasks = (
    await serverQuery(
      `SELECT t.id, t.title, t.status, t.start_date, t.end_date, t.priority, p.name AS project
       FROM project_tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.assigned_to = $1 AND t.kind = 'task' AND t.status <> 'completed' AND p.status <> 'completed'
       ORDER BY t.end_date NULLS LAST, t.id LIMIT 80`,
      [person.id],
    )
  ).rows as TaskRow[];
  const overdue = tasks.filter((t) => t.end_date && t.end_date < day);
  const dueToday = tasks.filter((t) => !overdue.includes(t) && ((t.start_date && t.start_date <= day && (!t.end_date || t.end_date >= day)) || t.end_date === day));
  const soon = tasks.filter((t) => !overdue.includes(t) && !dueToday.includes(t) && t.start_date && t.start_date > day && t.start_date <= weekEnd);

  let events: OutlookEvent[] = [];
  let calendarNote = "";
  if (prefs.o365_calendar) {
    const result = await outlookEvents(person.email, day, day);
    if ("events" in result) events = result.events;
    else calendarNote = result.error;
  }

  const facts = {
    firstName: person.name.split(" ")[0],
    today: day,
    overdue: overdue.slice(0, 10).map((t) => ({ title: t.title, project: t.project, due: t.end_date })),
    dueToday: dueToday.slice(0, 10).map((t) => ({ title: t.title, project: t.project, due: t.end_date })),
    comingUp: soon.slice(0, 10).map((t) => ({ title: t.title, project: t.project, starts: t.start_date })),
    calendarToday: events.slice(0, 12).map((e) => ({ title: e.title, from: e.allDay ? "all day" : e.start.slice(11), to: e.end.slice(11), where: e.location })),
    projects: [...new Set(tasks.map((t) => t.project))].slice(0, 10),
  };

  // The editorial: AI when set up, otherwise a plain greeting. The lists below are always exact.
  let headline = L.paper;
  let editorial = L.hello(facts.firstName);
  try {
    const { provider, apiKey, model } = await aiConfig();
    if (apiKey) {
      const text = await writeSummary({ provider, apiKey, model, language: lang, facts, kind: "morning" });
      const [first, ...rest] = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (first && rest.length) {
        headline = first.replace(/^["«»]+|["«»]+$/g, "");
        editorial = rest.join("\n\n");
      } else if (first) editorial = first;
    }
  } catch (err) {
    console.error("morning editorial failed", err);
  }

  const dateLabel = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const taskLine = (t: TaskRow, extra: string) => `${t.title} — ${t.project}${extra}`;
  const sections: { title: string; accent: string; lines: string[] }[] = [];
  if (overdue.length) sections.push({ title: L.overdue, accent: "#c0392b", lines: overdue.map((t) => taskLine(t, t.end_date ? ` (${t.end_date})` : "")) });
  if (dueToday.length) sections.push({ title: L.today, accent: "#e4002b", lines: dueToday.map((t) => taskLine(t, "")) });
  if (events.length)
    sections.push({
      title: L.calendar,
      accent: "#0f6cbd",
      lines: events.map((e) => `${e.allDay ? L.allDay : `${e.start.slice(11)}–${e.end.slice(11)}`} · ${e.title}${e.location ? ` (${e.location})` : ""}`),
    });
  if (soon.length) sections.push({ title: L.soon, accent: "#5f6368", lines: soon.map((t) => taskLine(t, ` (${t.start_date})`)) });

  const html = `<!doctype html><html><body style="margin:0;background:#f1efe9;font-family:Georgia,'Times New Roman',serif;color:#222">
<div style="max-width:640px;margin:0 auto;background:#fffdf8;border:1px solid #d9d4c7">
  <div style="background:#1b1b1b;color:#fff;text-align:center;padding:18px 16px 12px"><div style="font-size:26px;letter-spacing:4px;font-weight:bold">${esc(L.paper)}</div>
  <div style="font-size:12px;letter-spacing:1px;color:#d8d2c3;margin-top:4px;text-transform:capitalize">${esc(dateLabel)}</div></div>
  <div style="height:4px;background:#e4002b"></div>
  <div style="padding:24px 28px">
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 12px">${esc(headline)}</h1>
    ${editorial.split(/\n+/).map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(p)}</p>`).join("")}
    ${
      sections.length
        ? sections
            .map(
              (s) => `<h2 style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${s.accent};border-bottom:2px solid ${s.accent};padding-bottom:4px;margin:22px 0 8px">${esc(s.title)}</h2>
    <ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li style="font-size:14px;line-height:1.55;margin:3px 0">${esc(l)}</li>`).join("")}</ul>`,
            )
            .join("")
        : `<p style="font-size:14px;color:#555;font-style:italic">${esc(L.nothing)}</p>`
    }
    ${calendarNote ? `<p style="font-size:12px;color:#a33;margin-top:16px">Outlook : ${esc(calendarNote)}</p>` : ""}
  </div>
  <div style="padding:12px 28px 20px;font-size:11px;color:#8a8577;border-top:1px solid #e5e0d3">${esc(L.footer)}</div>
</div></body></html>`;
  const text = [headline, "", editorial, ...sections.flatMap((s) => ["", s.title.toUpperCase(), ...s.lines.map((l) => `- ${l}`)])].join("\n");
  return { subject: L.subject(dateLabel), html, text };
}

export async function sendMail(to: string, mail: { subject: string; html: string; text: string }) {
  let stored: Smtp | undefined;
  try {
    const raw = await readStoredSetting("smtp");
    if (raw) stored = JSON.parse(raw) as Smtp;
  } catch {
    stored = undefined;
  }
  const smtp = mergeSmtp(stored);
  if (!smtp.host || !smtp.from_email) throw new Error("email:notConfigured");
  const port = Number(smtp.port) || 587;
  const transporter = nodemailer.createTransport({ host: smtp.host, port, secure: Boolean(smtp.secure) || port === 465, auth: smtp.username ? { user: smtp.username, pass: smtp.password || "" } : undefined });
  await transporter.sendMail({ from: smtp.from_name ? { name: smtp.from_name, address: smtp.from_email } : smtp.from_email, to, subject: mail.subject, text: mail.text, html: mail.html });
}

/** Builds and sends one person's morning email. */
export async function sendMorningTo(userId: number) {
  const person = (await serverQuery("SELECT id, name, email, locale FROM users WHERE id = $1 AND is_active = 1", [userId])).rows[0] as Person | undefined;
  if (!person?.email) throw new Error("noUser");
  const prefs = ((await serverQuery("SELECT o365_calendar FROM user_prefs WHERE user_id = $1", [userId])).rows[0] ?? { o365_calendar: 0 }) as { o365_calendar: number };
  await sendMail(person.email, await buildMorning(person, prefs));
  return person.email;
}

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const { day, hour } = nowInZone();
    if (hour < FIRST_HOUR || hour > LAST_HOUR) return;
    const due = (
      await serverQuery(
        `SELECT u.id FROM users u JOIN user_prefs p ON p.user_id = u.id
         WHERE p.morning_email = 1 AND u.is_active = 1 AND u.user_type = 'internal' AND (p.morning_sent_on IS NULL OR p.morning_sent_on <> $1)`,
        [day],
      )
    ).rows as { id: number }[];
    for (const { id } of due) {
      // marked first: a broken mail server must not be retried every few minutes all morning
      await serverQuery("UPDATE user_prefs SET morning_sent_on = $2 WHERE user_id = $1", [id, day]);
      try {
        await sendMorningTo(id);
      } catch (err) {
        console.error(`morning email for user ${id} failed`, err);
      }
    }
  } catch (err) {
    console.error("morning email check failed", err);
  } finally {
    running = false;
  }
}

/** Checks every few minutes whether anyone's morning email is due. Only on the live server (it needs the database). */
export function startMorningScheduler() {
  if (!hasDatabase()) return;
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), 5 * 60_000);
}
