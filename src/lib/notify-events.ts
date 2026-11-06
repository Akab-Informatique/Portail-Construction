import type { NotifyChannel, NotifyResult } from "./notify";

/** What can be told to the people of a project, each remembered on its own: a switch and the way (email, text message). */
export type EventKind = "task" | "billing" | "qrt_answer" | "document";
export type EventPref = { on: boolean; email: boolean; sms: boolean };
const key = (kind: EventKind) => `frx.notify.${kind}`;

export function readEventPref(kind: EventKind): EventPref {
  try {
    const raw = localStorage.getItem(key(kind));
    if (raw) return { on: false, email: true, sms: false, ...(JSON.parse(raw) as Partial<EventPref>) };
  } catch {
    /* storage unavailable */
  }
  return { on: false, email: true, sms: false };
}

export function writeEventPref(kind: EventKind, pref: EventPref) {
  try {
    localStorage.setItem(key(kind), JSON.stringify(pref));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Tells the project's clients and/or staff about something that just happened, when the person left the switch on for this
 * kind of event. Off by default, so nothing is sent unless it was turned on; the server finds who to tell.
 */
export async function notifyProjectEvent(input: { kind: EventKind; projectId: number; audience: "clients" | "staff" | "both"; subject: string; text: string }): Promise<NotifyResult | null> {
  const pref = readEventPref(input.kind);
  if (!pref.on) return null;
  const channels: NotifyChannel[] = [...(pref.email ? (["email"] as const) : []), ...(pref.sms ? (["sms"] as const) : [])];
  if (channels.length === 0) return null;
  const res = await fetch("/api/notify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: input.projectId, audience: input.audience, channels, subject: input.subject, text: input.text }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as Partial<NotifyResult> | null;
  if (!res || !res.ok || !data || typeof data.email !== "number") return { email: 0, sms: 0, failed: [], skipped: [], dev: true };
  return { email: data.email, sms: data.sms ?? 0, failed: data.failed ?? [], skipped: data.skipped ?? [] };
}
