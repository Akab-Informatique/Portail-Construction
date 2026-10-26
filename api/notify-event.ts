import { requireApiUser, serverQuery } from "./db.ts";
import { sendMail } from "./_lib/morning.ts";

type Person = { id: number; name: string; email: string | null; locale: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TEXT = {
  fr: {
    comment: (who: string, project: string) => `${who} a commenté une note · ${project}`,
    question: (who: string, project: string) => `${who} pose une question (QRT) · ${project}`,
    open: "Ouvrir dans le portail",
  },
  en: {
    comment: (who: string, project: string) => `${who} commented on a note · ${project}`,
    question: (who: string, project: string) => `${who} asked a question (QRT) · ${project}`,
    open: "Open in the portal",
  },
};

function body(text: string, link: string, label: string) {
  return {
    text: `${text}\n\n${link}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222"><p style="white-space:pre-wrap">${esc(text)}</p><p><a href="${link}" style="color:#e4002b;font-weight:bold">${esc(label)}</a></p></div>`,
  };
}

/**
 * Tells the right people by email about something a person just did on a project: a comment under a note (the
 * author of the note hears about it) or a question a client asked in QRT (the people on the project hear about it).
 * Body: { kind: "note_comment" | "qrt", id }. Only the person who did it can trigger it, and recipients are looked up here.
 */
export default async function handler(
  req: { method?: string; body?: Record<string, unknown>; headers?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => unknown }; json: (body: unknown) => unknown },
) {
  if (req.method !== "POST") return res.status(405).json({ error: "err.badRequest" });
  const user = await requireApiUser(req);
  if (!user) return res.status(401).json({ error: "err.unauthorized" });
  const kind = String(req.body?.kind ?? "");
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "err.badRequest" });
  const origin = (process.env.PUBLIC_URL || String(req.headers?.origin || "")).replace(/\/$/, "");

  let recipients: Person[] = [];
  let subject = "";
  let text = "";
  let path = "";
  let project = "";

  if (kind === "note_comment") {
    const row = (
      await serverQuery(
        `SELECT c.body, c.project_id, n.user_id AS author_id, p.name AS project, p.project_number
         FROM note_comments c JOIN project_notes n ON n.id = c.note_id JOIN projects p ON p.id = c.project_id
         WHERE c.id = $1 AND c.user_id = $2`,
        [id, user.id],
      )
    ).rows[0] as { body: string; project_id: number; author_id: number | null; project: string; project_number: string } | undefined;
    if (!row) return res.status(404).json({ error: "err.badRequest" });
    if (row.author_id && row.author_id !== user.id) {
      recipients = (await serverQuery("SELECT id, name, email, locale FROM users WHERE id = $1 AND is_active = 1 AND user_type = 'internal'", [row.author_id])).rows as Person[];
    }
    project = `${row.project_number} ${row.project}`.trim();
    text = row.body;
    path = `/projects/${row.project_id}/notes`;
    subject = "note";
  } else if (kind === "qrt") {
    const row = (
      await serverQuery(
        `SELECT q.question, q.project_id, p.name AS project, p.project_number
         FROM project_qrt q JOIN projects p ON p.id = q.project_id
         WHERE q.id = $1 AND q.asked_by = $2 AND q.origin = 'client'`,
        [id, user.id],
      )
    ).rows[0] as { question: string; project_id: number; project: string; project_number: string } | undefined;
    if (!row) return res.status(404).json({ error: "err.badRequest" });
    recipients = (
      await serverQuery(
        `SELECT DISTINCT u.id, u.name, u.email, u.locale FROM users u JOIN project_members pm ON pm.user_id = u.id
         WHERE pm.project_id = $1 AND u.is_active = 1 AND u.user_type = 'internal'`,
        [row.project_id],
      )
    ).rows as Person[];
    // Nobody assigned yet: the administrators hear about it.
    if (!recipients.length) recipients = (await serverQuery("SELECT id, name, email, locale FROM users WHERE is_active = 1 AND is_admin = 1 AND user_type = 'internal'")).rows as Person[];
    project = `${row.project_number} ${row.project}`.trim();
    text = row.question;
    path = `/projects/${row.project_id}/qrt`;
    subject = "qrt";
  } else {
    return res.status(400).json({ error: "err.badRequest" });
  }

  let sent = 0;
  for (const person of recipients) {
    if (!person.email) continue;
    const L = TEXT[person.locale === "en" ? "en" : "fr"];
    const line = subject === "note" ? L.comment(user.name, project) : L.question(user.name, project);
    const content = body(text.slice(0, 1000), `${origin}${path}`, L.open);
    try {
      await sendMail(person.email, { subject: line, text: content.text, html: content.html });
      sent++;
    } catch (err) {
      console.error("notify-event email failed", err);
    }
  }
  return res.status(200).json({ sent });
}
