import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";

export type UserPrefs = { morning_email: number; o365_calendar: number };

export const NO_PREFS: UserPrefs = { morning_email: 0, o365_calendar: 0 };

/** The person's own settings (Outlook calendar, morning email); all off until they switch them on. */
export async function loadPrefs(userId: number): Promise<UserPrefs> {
  await dbReady;
  const [row] = await db.select().from(schema.user_prefs).where(eq(schema.user_prefs.user_id, userId));
  return row ? { morning_email: row.morning_email, o365_calendar: row.o365_calendar } : { ...NO_PREFS };
}

export async function savePrefs(userId: number, patch: Partial<UserPrefs>): Promise<UserPrefs> {
  await dbReady;
  const [row] = await db.select().from(schema.user_prefs).where(eq(schema.user_prefs.user_id, userId));
  if (row) await db.update(schema.user_prefs).set(patch).where(eq(schema.user_prefs.user_id, userId));
  else await db.insert(schema.user_prefs).values({ user_id: userId, ...patch });
  return loadPrefs(userId);
}

export type OutlookEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string };
export type PersonalResult = { local?: boolean; error?: string; events?: OutlookEvent[]; sent?: string };

/** Calls the portal server for the Outlook calendar and the morning email. Answers { local: true } where there is no server (local development). */
export async function personalCall(body: Record<string, unknown>): Promise<PersonalResult> {
  try {
    const res = await fetch("/api/personal", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as PersonalResult;
  } catch {
    return { local: true };
  }
}
