import { hasDatabase, isInternalStaff, requireApiUser, serverQuery } from "./db.ts";
import { nowInZone, outlookEvents, sendMorningTo } from "./_lib/morning.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 62;

/**
 * A person's own extras. Staff only, and only ever about the signed-in person.
 *  - calendar: their Outlook events between two days (their profile must have the Outlook calendar switched on).
 *  - calendar_test: reads the next 7 days to show the connection works.
 *  - morning_test: sends the morning email now.
 */
export default async function handler(
  req: { method?: string; body?: Record<string, unknown>; headers?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => unknown }; json: (body: unknown) => unknown },
) {
  if (req.method !== "POST") return res.status(405).json({ error: "err.badRequest" });
  // Local development has no server database: these features only exist on the live portal.
  if (!hasDatabase()) return res.status(200).json({ local: true });
  const user = await requireApiUser(req);
  if (!user) return res.status(401).json({ error: "err.unauthorized" });
  if (!isInternalStaff(user)) return res.status(403).json({ error: "err.forbidden" });
  const action = String(req.body?.action ?? "");

  const prefs = ((await serverQuery("SELECT o365_calendar FROM user_prefs WHERE user_id = $1", [user.id])).rows[0] ?? { o365_calendar: 0 }) as { o365_calendar: number };
  // Always the person's own portal email: nobody can point this at someone else's mailbox.
  const mailbox = (user.email || "").trim();

  if (action === "calendar" || action === "calendar_test") {
    // The test works before the switch is saved, so the person can check the connection first.
    if (action === "calendar" && !prefs.o365_calendar) return res.status(200).json({ events: [] });
    let from = String(req.body?.from ?? "");
    let to = String(req.body?.to ?? "");
    if (action === "calendar_test") {
      const { day } = nowInZone();
      from = day;
      to = new Date(new Date(`${day}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    }
    if (!DAY.test(from) || !DAY.test(to) || to < from || (new Date(to).getTime() - new Date(from).getTime()) / 86400000 > MAX_SPAN_DAYS) return res.status(400).json({ error: "err.badRequest" });
    if (!mailbox) return res.status(200).json({ error: "noMailbox" });
    return res.status(200).json(await outlookEvents(mailbox, from, to));
  }

  if (action === "morning_test") {
    try {
      return res.status(200).json({ sent: await sendMorningTo(user.id) });
    } catch (err) {
      console.error("morning test failed", err);
      return res.status(200).json({ error: err instanceof Error ? err.message : "failed" });
    }
  }

  return res.status(400).json({ error: "err.badRequest" });
}
