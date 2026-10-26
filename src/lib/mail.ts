import type { SmtpSettings } from "./types";

export async function sendInvoiceEmail(input: {
  smtp: SmtpSettings;
  to: string | string[];
  subject: string;
  text: string;
  filename: string;
  pdfBase64: string;
}) {
  const res = await fetch("/api/mail/send", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      text: input.text,
      filename: input.filename,
      pdfBase64: input.pdfBase64,
      smtp: {
        host: input.smtp.host,
        port: input.smtp.port,
        from_name: input.smtp.from_name,
        from_email: input.smtp.from_email,
        secure: input.smtp.secure,
      },
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
  if (!res.ok) {
    throw new Error(payload.error || `mail.error.sendFailed:${res.status}`);
  }
  return payload;
}
