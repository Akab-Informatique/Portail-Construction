import { sql } from "drizzle-orm";
import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../db";

export type UserLogin = typeof schema.user_logins.$inferSelect;

/**
 * What the account says about a person:
 *  - inactive: switched off by an administrator;
 *  - active: the person set their own password / signed in, so the account is activated;
 *  - pending: an invitation or temporary password was given and the person has not activated it yet;
 *  - never: an account that has not signed in since sign-ins are recorded.
 */
export type AccountState = "inactive" | "active" | "pending" | "never";

export function accountState(user: { is_active: number; must_change_password: number }, login: UserLogin | undefined): AccountState {
  if (!user.is_active) return "inactive";
  if (login?.activated_at) return "active";
  if (user.must_change_password === 1) return "pending";
  return login?.last_login_at ? "active" : "never";
}

let cache: { at: number; rows: Map<number, UserLogin> } | null = null;
let inflight: Promise<Map<number, UserLogin>> | null = null;
const listeners = new Set<(rows: Map<number, UserLogin>) => void>();

/** Sign-in records of everybody (administrators only: for anyone else the table is empty to them). One request is shared by every row on screen. */
export async function loadUserLogins(force = false): Promise<Map<number, UserLogin>> {
  if (!force && cache && Date.now() - cache.at < 20_000) return cache.rows;
  if (!inflight) {
    inflight = (async () => {
      try {
        await dbReady;
        const rows = await db.select().from(schema.user_logins);
        cache = { at: Date.now(), rows: new Map(rows.map((r) => [r.user_id, r])) };
      } catch {
        cache = { at: Date.now(), rows: new Map() };
      }
      inflight = null;
      listeners.forEach((fn) => fn(cache!.rows));
      return cache.rows;
    })();
  }
  return inflight;
}

export function useUserLogins(): Map<number, UserLogin> {
  const [rows, setRows] = useState<Map<number, UserLogin>>(() => cache?.rows ?? new Map());
  useEffect(() => {
    listeners.add(setRows);
    void loadUserLogins().then(setRows);
    return () => {
      listeners.delete(setRows);
    };
  }, []);
  return rows;
}

/**
 * Local (browser database) sign-in: the live server records its own sign-ins. `mustChange` is whether the person still has a
 * temporary password: they are activated once they have chosen their own.
 */
export async function recordLocalLogin(userId: number, mustChange: boolean) {
  try {
    await dbReady;
    const now = new Date();
    await db
      .insert(schema.user_logins)
      .values({ user_id: userId, last_login_at: now, login_count: 1, activated_at: mustChange ? null : now })
      .onConflictDoUpdate({
        target: schema.user_logins.user_id,
        set: { last_login_at: now, login_count: sql`${schema.user_logins.login_count} + 1`, ...(mustChange ? {} : { activated_at: sql`coalesce(${schema.user_logins.activated_at}, ${now.toISOString()}::timestamp)` }) },
      });
  } catch {
    /* recording a sign-in must never stop one */
  }
}

export async function markLocalActivated(userId: number) {
  try {
    await dbReady;
    const now = new Date();
    await db
      .insert(schema.user_logins)
      .values({ user_id: userId, activated_at: now, login_count: 0 })
      .onConflictDoUpdate({ target: schema.user_logins.user_id, set: { activated_at: sql`coalesce(${schema.user_logins.activated_at}, ${now.toISOString()}::timestamp)` } });
  } catch {
    /* ignore */
  }
}
