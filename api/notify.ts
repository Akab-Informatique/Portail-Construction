import nodemailer from "nodemailer";
import { isInternalStaff, readStoredSetting, requireApiUser, serverQuery } from "./db.ts";
import { mergeSmtp, type Smtp } from "./_lib/smtp.ts";

const MAX_RECIPIENTS = 20;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

type Sms = { enabled?: boolean; account_sid?: string; api_key?: string; from?: string };

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

/**
 * Tells people about something on a project, by email and/or SMS. Staff only.
 * Body: { user_ids: number[], channels: ("email"|"sms")[], subject, text }.
 * The server looks up each person's email and phone itself; the browser never supplies addresses.
 */
export default async function handler(
  req: { method?: string; body?: Record<string, unknown>; headers?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => unknown }; json: (body: unknown) => unknown },
) {
  if (req.method !== "POST") return res.status(405).json({ error: "err.badRequest" });
  const user = await requireApiUser(req);
  if (!user) return res.status(401).json({ error: "err.unauthorized" });
  if (!isInternalStaff(user)) return res.status(403).json({ error: "err.forbidden" });

  let ids = (Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_RECIPIENTS);

  // A project event (a document, an invoice, a task...): the people to tell are the project's clients and/or staff, found here.
  const projectId = Number(req.body?.project_id);
  if (Number.isInteger(projectId) && projectId > 0) {
    const audience = String(req.body?.audience ?? "clients");
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
    if (!ids.length) return res.status(200).json({ email: 0, sms: 0, failed: [], skipped: ["none"] });
  }
  const channels = (Array.isArray(req.body?.channels) ? req.body.channels : []).map(String);
  const subject = String(req.body?.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = String(req.body?.text ?? "").slice(0, 4000);
  if (!ids.length || !text || !channels.length) return res.status(400).json({ error: "err.badRequest" });

  const people = (await serverQuery("SELECT id, name, email, phone FROM users WHERE id = ANY($1::int[]) AND is_active = 1", [ids])).rows as {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
  }[];

  const result = { email: 0, sms: 0, failed: [] as string[], skipped: [] as string[] };

  if (channels.includes("email")) {
    let stored: Smtp | undefined;
    try {
      const raw = await readStoredSetting("smtp");
      if (raw) stored = JSON.parse(raw) as Smtp;
    } catch {
      stored = undefined;
    }
    const smtp = mergeSmtp(stored);
    const to = people.map((p) => p.email ?? "").filter((e) => EMAIL.test(e));
    if (!smtp.host || !smtp.from_email) result.skipped.push("email:notConfigured");
    else if (to.length) {
      const port = Number(smtp.port) || 587;
      try {
        const transporter = nodemailer.createTransport({
          host: smtp.host,
          port,
          secure: Boolean(smtp.secure) || port === 465,
          auth: smtp.username ? { user: smtp.username, pass: smtp.password || "" } : undefined,
        });
        await transporter.sendMail({
          from: smtp.from_name ? { name: smtp.from_name, address: smtp.from_email } : smtp.from_email,
          to: to.join(", "),
          subject: subject || "Notification",
          text,
        });
        result.email = to.length;
      } catch (err) {
        console.error("notify email failed", err);
        result.failed.push("email");
      }
    }
  }

  if (channels.includes("sms")) {
    let sms: Sms = {};
    try {
      const raw = await readStoredSetting("sms");
      if (raw) sms = JSON.parse(raw) as Sms;
    } catch {
      sms = {};
    }
    if (sms.enabled === false || !sms.account_sid || !sms.api_key || !sms.from) result.skipped.push("sms:notConfigured");
    else {
      for (const p of people) {
        const to = p.phone ? e164(p.phone) : null;
        if (!to) {
          result.skipped.push(`sms:noPhone:${p.name}`);
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
