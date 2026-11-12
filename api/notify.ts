import nodemailer from "nodemailer";
import { clientScopeOf, isInternalStaff, readStoredSetting, requireApiUser, serverQuery } from "./db.ts";
import { mergeSmtp, type Smtp } from "./_lib/smtp.ts";

const MAX_RECIPIENTS = 20;
const MAX_TEXT = 4000;
const MAX_SUBJECT = 200;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

type Sms = { enabled?: boolean; account_sid?: string; api_key?: string; from?: string };
type Session = NonNullable<Awaited<ReturnType<typeof requireApiUser>>>;
type Req = { method?: string; body?: Record<string, unknown>; headers?: Record<string, unknown> };
type Res = { status: (code: number) => { json: (body: unknown) => unknown }; json: (body: unknown) => unknown };

/**
 * What a client account may report to the staff of a project. The wording is fixed here, written by the server, so a client
 * never writes the subject or the body of what staff receive; it only gives a short summary.
 */
const CLIENT_EVENTS: Record<string, { fr: string; en: string; path: string }> = {
  note_comment: { fr: "Nouveau commentaire sur une note", en: "New comment on a note", path: "notes" },
  qrt: { fr: "Nouvelle question (QRT)", en: "New question (QRT)", path: "qrt" },
  billing_request: { fr: "Nouvelle demande sur une facture ou une soumission", en: "New request on an invoice or quote", path: "billing" },
  quote_change: { fr: "Nouvelle demande de modification de soumission", en: "New change request on a quote", path: "billing" },
};
const CLIENT_SUMMARY_MAX = 300;
/** A client account may send at most this many reports per window (in memory, per server process). */
const CLIENT_WINDOW_MS = 10 * 60 * 1000;
const CLIENT_WINDOW_MAX = 30;
const clientSends = new Map<number, number[]>();

function clientThrottled(userId: number) {
  const now = Date.now();
  const recent = (clientSends.get(userId) ?? []).filter((at) => now - at < CLIENT_WINDOW_MS);
  const limited = recent.length >= CLIENT_WINDOW_MAX;
  if (!limited) recent.push(now);
  clientSends.set(userId, recent);
  if (clientSends.size > 5000) clientSends.clear();
  return limited;
}

/** Plain text only: control characters dropped, line endings normalised, length capped. Never HTML. */
function plain(raw: unknown, max: number) {
  const kept = Array.from(String(raw ?? "").replace(/\r\n?/g, "\n"))
    .filter((c) => c === "\n" || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127))
    .join("");
  return kept.trim().slice(0, max);
}

/** Keeps digits and a leading +; assumes North America for a bare 10-digit number. */
function e164(raw: string) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return /^\+\d{8,15}$/.test(digits) ? digits : null;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

async function sendSms(sms: Sms, to: string, body: string) {
  const auth = Buffer.from(`${sms.account_sid}:${sms.api_key}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.account_sid ?? "")}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: sms.from ?? "", Body: body.slice(0, 1500) }).toString(),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || `SMS failed (${res.status})`);
  }
}

async function loadSmtp(): Promise<Smtp> {
  let stored: Smtp | undefined;
  try {
    const raw = await readStoredSetting("smtp");
    if (raw) stored = JSON.parse(raw) as Smtp;
  } catch {
    stored = undefined;
  }
  return mergeSmtp(stored);
}

async function loadSms(): Promise<Sms> {
  try {
    const raw = await readStoredSetting("sms");
    return raw ? (JSON.parse(raw) as Sms) : {};
  } catch {
    return {};
  }
}

async function sendEmail(smtp: Smtp, to: string[], subject: string, text: string) {
  const port = Number(smtp.port) || 587;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: Boolean(smtp.secure) || port === 465,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password || "" } : undefined,
  });
  await transporter.sendMail({
    from: smtp.from_name ? { name: smtp.from_name, address: smtp.from_email ?? "" } : smtp.from_email,
    to: to.join(", "),
    subject: subject || "Notification",
    text,
  });
}

/**
 * Tells people about something on a project, by email and/or SMS.
 *
 * Staff (internal accounts) choose recipients: body { user_ids } or { project_id, audience: "clients"|"staff"|"both" },
 * with channels ["email"|"sms"], subject and text. Every reply lists what was sent and what was skipped, and why.
 *
 * A client account may only report to the staff of a project it belongs to: body { project_id, event, summary }. The server
 * checks the project against the client's own companies, finds the admins and project members itself, and writes the text.
 *
 * The server looks up each person's email and phone itself; the browser never supplies addresses.
 */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") return res.status(405).json({ error: "err.badRequest" });
  const user = await requireApiUser(req);
  if (!user) return res.status(401).json({ error: "err.unauthorized" });
  if (isInternalStaff(user)) return notifyAsStaff(user, req, res);
  if (user.user_type === "external") return notifyAsClient(user, req, res);
  return res.status(403).json({ error: "err.forbidden" });
}

async function notifyAsClient(user: Session, req: Req, res: Res) {
  const body = req.body ?? {};
  const projectId = Number(body.project_id);
  const event = CLIENT_EVENTS[String(body.event ?? "")];
  if (!Number.isInteger(projectId) || projectId <= 0 || !event) return res.status(400).json({ error: "err.badRequest" });

  const project = (
    await serverQuery("SELECT id, name, project_number, client_id FROM projects WHERE id = $1", [projectId])
  ).rows[0] as { id: number; name: string; project_number: string; client_id: number } | undefined;
  // Same rule as the rest of the portal: a client sees a project only through its own companies.
  const scope = await clientScopeOf(user);
  const allowed = project && (scope === "*" || scope.split(",").map(Number).includes(project.client_id));
  if (!project || !allowed) return res.status(403).json({ error: "err.forbidden" });
  if (clientThrottled(user.id)) return res.status(429).json({ error: "err.tooMany" });

  const people = (
    await serverQuery(
      `SELECT DISTINCT u.id, u.name, u.email FROM users u
       WHERE u.is_active = 1 AND u.user_type = 'internal' AND u.id <> $2
         AND (u.is_admin = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id))`,
      [project.id, user.id],
    )
  ).rows as { id: number; name: string; email: string | null }[];
  const to = [...new Set(people.map((p) => p.email ?? "").filter((e) => EMAIL.test(e)))];
  const smtp = await loadSmtp();
  if (!to.length || !smtp.host || !smtp.from_email) {
    // Nothing to send, or mail is not set up: the client is not told either way, staff can see it in Setup.
    return res.status(200).json({ email: 0, sms: 0, failed: [], skipped: [] });
  }

  const locale = String((user as { locale?: unknown }).locale ?? "fr") === "en" ? "en" : "fr";
  const label = locale === "en" ? event.en : event.fr;
  const summary = plain(body.summary, CLIENT_SUMMARY_MAX).replace(/\n+/g, " ");
  const origin = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  const link = origin ? `${origin}/projects/${project.id}/${event.path}` : "";
  const subject = plain(`${label} · ${project.project_number} ${project.name}`, MAX_SUBJECT).replace(/\n+/g, " ");
  const text = [label, `${plain(user.name, 120).replace(/\n+/g, " ")}${summary ? `: ${summary}` : ""}`, link].filter(Boolean).join("\n\n");

  let sent = 0;
  const failed: string[] = [];
  for (let i = 0; i < to.length; i += MAX_RECIPIENTS) {
    const batch = to.slice(i, i + MAX_RECIPIENTS);
    try {
      await sendEmail(smtp, batch, subject, text);
      sent += batch.length;
    } catch (err) {
      console.error("client notify email failed", err);
      failed.push("email");
    }
  }
  return res.status(200).json({ email: sent, sms: 0, failed, skipped: [] });
}

async function notifyAsStaff(user: Session, req: Req, res: Res) {
  const body = req.body ?? {};
  let ids = (Array.isArray(body.user_ids) ? body.user_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_RECIPIENTS);

  // A project event (a document, an invoice, a task...): the people to tell are the project's clients and/or staff, found here.
  const projectId = Number(body.project_id);
  if (Number.isInteger(projectId) && projectId > 0) {
    const audience = String(body.audience ?? "clients");
    const allowedStaff = (
      await serverQuery(
        `SELECT 1 FROM users u WHERE u.id = $1 AND (u.is_admin = 1 OR u.all_clients <> 0 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = u.id))`,
        [user.id, projectId],
      )
    ).rows;
    if (!allowedStaff.length) return res.status(403).json({ error: "err.forbidden" });
    const found: number[] = [];
    if (audience === "clients" || audience === "both") {
      const rows = (
        await serverQuery(
          `SELECT DISTINCT u.id FROM users u
           JOIN client_users cu ON cu.user_id = u.id
           JOIN projects p ON p.client_id = cu.client_id AND p.id = $1
           WHERE u.is_active = 1 AND u.user_type = 'external'
             AND (EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id)
               OR EXISTS (SELECT 1 FROM group_projects gp JOIN user_access_groups ug ON ug.group_id = gp.group_id AND ug.user_id = u.id WHERE gp.project_id = $1))`,
          [projectId],
        )
      ).rows as { id: number }[];
      found.push(...rows.map((r) => r.id));
    }
    if (audience === "staff" || audience === "both") {
      const rows = (
        await serverQuery(
          `SELECT DISTINCT u.id FROM users u WHERE u.is_active = 1 AND u.user_type = 'internal' AND u.id <> $2
             AND (u.is_admin = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id))`,
          [projectId, user.id],
        )
      ).rows as { id: number }[];
      found.push(...rows.map((r) => r.id));
    }
    ids = [...new Set(found)].slice(0, MAX_RECIPIENTS);
  }

  const channels = (Array.isArray(body.channels) ? body.channels : []).map(String).filter((c) => c === "email" || c === "sms");
  const subject = plain(body.subject, MAX_SUBJECT).replace(/\n+/g, " ");
  const text = plain(body.text, MAX_TEXT);
  if (!channels.length || !text) return res.status(400).json({ error: "err.badRequest" });

  const result = { email: 0, sms: 0, failed: [] as string[], skipped: [] as string[] };
  if (!ids.length) return res.status(200).json({ ...result, skipped: ["recipients:none"] });

  const people = (await serverQuery("SELECT id, name, email, phone FROM users WHERE id = ANY($1::int[]) AND is_active = 1", [ids])).rows as {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
  }[];
  if (!people.length) return res.status(200).json({ ...result, skipped: ["recipients:none"] });

  if (channels.includes("email")) {
    const smtp = await loadSmtp();
    if (!smtp.host || !smtp.from_email) result.skipped.push("email:notConfigured");
    else {
      const to: string[] = [];
      for (const p of people) {
        if (p.email && EMAIL.test(p.email)) to.push(p.email);
        else result.skipped.push(`email:noAddress:${p.name}`);
      }
      if (to.length) {
        try {
          await sendEmail(smtp, to, subject, text);
          result.email = to.length;
        } catch (err) {
          console.error("notify email failed", err);
          result.failed.push("email");
        }
      }
    }
  }

  if (channels.includes("sms")) {
    const sms = await loadSms();
    if (sms.enabled === false || !sms.account_sid || !sms.api_key || !sms.from) result.skipped.push("sms:notConfigured");
    else {
      for (const p of people) {
        if (!p.phone) {
          result.skipped.push(`sms:noPhone:${p.name}`);
          continue;
        }
        const to = e164(p.phone);
        if (!to) {
          result.skipped.push(`sms:badPhone:${p.name}`);
          continue;
        }
        try {
          await sendSms(sms, to, `${subject ? subject + "\n" : ""}${text}`);
          result.sms++;
        } catch (err) {
          console.error("notify sms failed", err);
          result.failed.push(`sms:${p.name}`);
        }
      }
    }
  }

  return res.status(200).json(result);
}
