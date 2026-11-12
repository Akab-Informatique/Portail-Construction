export type NotifyChannel = "email" | "sms";

/** Why nothing could be sent at all: the server was reached and refused, or it could not be reached. */
export type NotifyError = "network" | "forbidden" | "unauthorized" | "tooMany" | "server";

export type NotifyResult = {
  email: number;
  sms: number;
  failed: string[];
  /** Skipped, with a code: recipients:none, channels:none, email:notConfigured, email:noAddress:<name>, sms:notConfigured, sms:noPhone:<name>, sms:badPhone:<name>. */
  skipped: string[];
  /** True when there is no API server (local development page): nothing was sent. */
  dev?: boolean;
  error?: NotifyError;
};

const empty = (extra: Partial<NotifyResult> = {}): NotifyResult => ({ email: 0, sms: 0, failed: [], skipped: [], ...extra });

/** Posts to /api/notify. A failure comes back as `error` (or `dev` without a server), never as a silent success. */
export async function postNotify(body: Record<string, unknown>): Promise<NotifyResult> {
  let res: Response;
  try {
    res = await fetch("/api/notify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return empty({ error: "network" });
  }
  // A page served by a plain dev server has no /api at all.
  if (res.status === 404) return empty({ dev: true });
  if (!res.ok) {
    const error: NotifyError = res.status === 403 ? "forbidden" : res.status === 401 ? "unauthorized" : res.status === 429 ? "tooMany" : "server";
    return empty({ error });
  }
  const data = (await res.json().catch(() => null)) as Partial<NotifyResult> | null;
  if (!data || typeof data.email !== "number") return empty({ error: "server" });
  return { email: data.email, sms: data.sms ?? 0, failed: data.failed ?? [], skipped: data.skipped ?? [] };
}

/**
 * Tells people about something on a project by email and/or text message. The server looks up each
 * person's address and phone number itself.
 */
export async function sendNotification(input: { userIds: number[]; channels: NotifyChannel[]; subject: string; text: string }): Promise<NotifyResult> {
  if (!input.userIds.length) return empty({ skipped: ["recipients:none"] });
  if (!input.channels.length) return empty({ skipped: ["channels:none"] });
  return postNotify({ user_ids: input.userIds, channels: input.channels, subject: input.subject, text: input.text });
}

/** One line under a form saying what was sent, or why nothing was. */
export function notifySummary(result: NotifyResult, t: (key: never, vars?: Record<string, string | number>) => string): string {
  const say = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  if (result.dev) return say("ntf.dev");
  if (result.error) {
    const reason = say(result.error === "forbidden" ? "ntf.err.forbidden" : result.error === "tooMany" ? "ntf.err.tooMany" : result.error === "unauthorized" ? "ntf.err.unauthorized" : result.error === "network" ? "ntf.err.network" : "ntf.err.server");
    return say("ntf.error", { reason });
  }
  const parts: string[] = [];
  if (result.email) parts.push(say("ntf.emailSent", { n: result.email }));
  if (result.sms) parts.push(say("ntf.smsSent", { n: result.sms }));
  const skipped = result.skipped;
  const names = (prefix: string) => skipped.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length));
  if (skipped.includes("recipients:none")) parts.push(say("ntf.noRecipients"));
  if (skipped.includes("channels:none")) parts.push(say("ntf.noChannel"));
  if (skipped.includes("email:notConfigured")) parts.push(say("ntf.emailOff"));
  if (skipped.includes("sms:notConfigured")) parts.push(say("ntf.smsOff"));
  const noMail = names("email:noAddress:");
  if (noMail.length) parts.push(say("ntf.noEmail", { names: noMail.join(", ") }));
  const noPhone = names("sms:noPhone:");
  if (noPhone.length) parts.push(say("ntf.noPhone", { names: noPhone.join(", ") }));
  const badPhone = names("sms:badPhone:");
  if (badPhone.length) parts.push(say("ntf.badPhone", { names: badPhone.join(", ") }));
  if (result.failed.length) parts.push(say("ntf.failed"));
  return parts.length ? parts.join(" · ") : say("ntf.none");
}

/** Tells the right person by email about a comment under a note, or a client's question in QRT. The server decides who. */
export async function notifyEvent(kind: "note_comment" | "qrt", id: number): Promise<void> {
  try {
    await fetch("/api/notify-event", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }) });
  } catch {
    /* no server in local development */
  }
}

/**
 * A client account did something on its project (a comment, a question, a request): the staff of the project are told by
 * email, automatically, with no switch. The server checks the client may see the project and decides who hears.
 */
export function notifyStaffFromClient(projectId: number, event: "note_comment" | "qrt" | "billing_request" | "quote_change", summary: string): Promise<NotifyResult> {
  return postNotify({ project_id: projectId, event, summary });
}
