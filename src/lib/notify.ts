export type NotifyChannel = "email" | "sms";

export type NotifyResult = {
  email: number;
  sms: number;
  failed: string[];
  skipped: string[];
  /** True when there is no server (local development): nothing was sent. */
  dev?: boolean;
};

/**
 * Tells people about something on a project by email and/or text message. The server looks up each
 * person's address and phone number itself.
 */
export async function sendNotification(input: { userIds: number[]; channels: NotifyChannel[]; subject: string; text: string }): Promise<NotifyResult> {
  if (!input.userIds.length || !input.channels.length) return { email: 0, sms: 0, failed: [], skipped: [] };
  try {
    const res = await fetch("/api/notify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: input.userIds, channels: input.channels, subject: input.subject, text: input.text }),
    });
    const data = (await res.json().catch(() => null)) as Partial<NotifyResult> | null;
    if (!res.ok || !data || typeof data.email !== "number") return { email: 0, sms: 0, failed: [], skipped: [], dev: true };
    return { email: data.email, sms: data.sms ?? 0, failed: data.failed ?? [], skipped: data.skipped ?? [] };
  } catch {
    return { email: 0, sms: 0, failed: [], skipped: [], dev: true };
  }
}

/** One short line for a toast under a form, from a result. */
export function notifySummary(result: NotifyResult, t: (key: never, vars?: Record<string, string | number>) => string): string | null {
  const say = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  if (result.dev) return say("ntf.dev");
  const parts: string[] = [];
  if (result.email) parts.push(say("ntf.emailSent", { n: result.email }));
  if (result.sms) parts.push(say("ntf.smsSent", { n: result.sms }));
  if (result.skipped.some((s) => s.startsWith("sms:notConfigured"))) parts.push(say("ntf.smsOff"));
  if (result.skipped.some((s) => s.startsWith("email:notConfigured"))) parts.push(say("ntf.emailOff"));
  const noPhone = result.skipped.filter((s) => s.startsWith("sms:noPhone:")).map((s) => s.split(":")[2]);
  if (noPhone.length) parts.push(say("ntf.noPhone", { names: noPhone.join(", ") }));
  if (result.failed.length) parts.push(say("ntf.failed"));
  return parts.length ? parts.join(" · ") : null;
}
