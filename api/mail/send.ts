import nodemailer from "nodemailer";
import { isInternalStaff, readStoredSetting, requireApiUser } from "../db.ts";
import { mergeSmtp, type Smtp } from "../_lib/smtp.ts";

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const MAX_RECIPIENTS = 20;

export default async function handler(
  req: { method?: string; body?: Record<string, unknown>; headers?: Record<string, unknown> },
  res: {
    status: (code: number) => { json: (body: unknown) => unknown };
    json: (body: unknown) => unknown;
  },
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const user = await requireApiUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  // Clients must not be able to send arbitrary mail through the company SMTP account.
  if (!isInternalStaff(user)) return res.status(403).json({ error: "Forbidden" });

  let stored: Smtp | undefined;
  try {
    const raw = await readStoredSetting("smtp");
    if (raw) stored = JSON.parse(raw) as Smtp;
  } catch {
    stored = undefined;
  }
  // Server/host settings come only from env or saved settings, never from the request.
  const smtp = mergeSmtp(stored);
  const toRaw = req.body?.to;
  const recipients = (Array.isArray(toRaw) ? toRaw.map(String) : String(toRaw ?? "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  const subject = String(req.body?.subject ?? "Invoice").replace(/[\r\n]+/g, " ").slice(0, 300);
  const text = String(req.body?.text ?? "");
  const filename = String(req.body?.filename ?? "invoice.pdf").replace(/[\r\n"\\/]+/g, "_").slice(0, 200);
  const pdfBase64 = String(req.body?.pdfBase64 ?? "");

  if (!smtp.host || !smtp.from_email) {
    return res.status(400).json({ error: "SMTP is not configured." });
  }
  if (!recipients.length) return res.status(400).json({ error: "Recipient email is required." });
  if (recipients.length > MAX_RECIPIENTS || !recipients.every((r) => EMAIL.test(r))) {
    return res.status(400).json({ error: "Invalid recipient email." });
  }

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
      to: recipients.join(", "),
      subject,
      text,
      attachments: pdfBase64
        ? [{ filename, content: Buffer.from(pdfBase64, "base64"), contentType: "application/pdf" }]
        : [],
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("mail send failed", err);
    return res.status(500).json({ error: "Send failed" });
  }
}
