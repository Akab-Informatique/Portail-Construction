import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { User } from "./types";

const USER_COLUMNS = [
  "id",
  "name",
  "email",
  "password",
  "user_type",
  "title",
  "phone",
  "is_active",
  "is_admin",
  "avatar_initials",
  "locale",
  "theme",
  "all_clients",
  "must_change_password",
  "tutorial_done",
  "created_at",
] as const;

function rowToUser(row: unknown): User {
  const data = Array.isArray(row)
    ? Object.fromEntries(USER_COLUMNS.map((key, i) => [key, row[i]]))
    : ((row ?? {}) as Record<string, unknown>);
  return {
    id: Number(data.id),
    name: String(data.name ?? ""),
    email: String(data.email ?? ""),
    password: "",
    user_type: data.user_type === "external" ? "external" : "internal",
    title: data.title == null ? null : String(data.title),
    phone: data.phone == null ? null : String(data.phone),
    is_active: Number(data.is_active ?? 1),
    is_admin: Number(data.is_admin ?? 0),
    avatar_initials: data.avatar_initials == null ? null : String(data.avatar_initials),
    locale: data.locale === "fr" ? "fr" : "en",
    theme: data.theme === "dark" ? "dark" : "light",
    all_clients: Number(data.all_clients ?? 1),
    must_change_password: Number(data.must_change_password ?? 0),
    tutorial_done: Number(data.tutorial_done ?? 0),
    created_at: (data.created_at as Date) ?? new Date(),
  };
}

async function postDb(body: Record<string, unknown>) {
  const res = await fetch("/api/db", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    users?: unknown[];
    user?: unknown;
    local?: boolean;
    error?: string;
    ok?: boolean;
    email?: string;
  };
  return { ok: res.ok, status: res.status, data };
}

async function selectUsersFallback(): Promise<User[]> {
  const rows = (await db.select().from(schema.users)) as unknown[];
  return rows.map(rowToUser).filter((u) => Number.isFinite(u.id) && u.email);
}

export async function listUsers(): Promise<User[]> {
  try {
    const { ok, data } = await postDb({ action: "list_users" });
    if (data.local) return selectUsersFallback();
    if (ok && Array.isArray(data.users) && data.users.length) {
      return data.users.map(rowToUser);
    }
    if (ok && Array.isArray(data.users)) {
      const mapped = data.users.map(rowToUser).filter((u) => Number.isFinite(u.id));
      if (mapped.length) return mapped;
    }
  } catch {
    /* fall through to SQL select */
  }
  return selectUsersFallback();
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  user_type: "internal" | "external";
  title?: string | null;
  phone?: string | null;
  is_admin?: boolean;
  avatar_initials?: string | null;
  groupIds?: number[];
  must_change_password?: boolean;
}): Promise<User> {
  const { ok, data } = await postDb({ action: "create_user", ...input });
  if (data.local) {
    await db.insert(schema.users).values({
      name: input.name,
      email: input.email,
      password: input.password,
      user_type: input.user_type,
      title: input.title ?? null,
      phone: input.phone ?? null,
      is_active: 1,
      is_admin: input.is_admin ? 1 : 0,
      avatar_initials: input.avatar_initials ?? null,
      locale: "en",
      theme: "light",
      all_clients: input.user_type === "internal" && input.is_admin ? 1 : 0,
      must_change_password: input.must_change_password === false ? 0 : 1,
      tutorial_done: 0,
    });
    const rows = await selectUsersFallback();
    const created = rows.find((u) => u.email === input.email);
    if (!created) throw new Error("users.error.createFailed");
    return created;
  }
  if (ok && data.user) return rowToUser(data.user);
  if (!ok && data.error && data.error !== "err.badRequest" && data.error !== "err.notAllowed") {
    throw new Error(data.error);
  }
  await db.insert(schema.users).values({
    name: input.name,
    email: input.email,
    password: input.password,
    user_type: input.user_type,
    title: input.title ?? null,
    phone: input.phone ?? null,
    is_active: 1,
    is_admin: input.is_admin ? 1 : 0,
    avatar_initials: input.avatar_initials ?? null,
    locale: "en",
    theme: "light",
    all_clients: input.user_type === "internal" && input.is_admin ? 1 : 0,
    must_change_password: input.must_change_password === false ? 0 : 1,
    tutorial_done: 0,
  });
  const rows = await selectUsersFallback();
  const created = rows.find((u) => u.email === input.email);
  if (!created) throw new Error(data.error || "users.error.createFailed");
  return created;
}

export async function updateUser(input: {
  id: number;
  name: string;
  email: string;
  title?: string | null;
  phone?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
  avatar_initials?: string | null;
  password?: string;
  must_change_password?: boolean;
}): Promise<User> {
  const { ok, data } = await postDb({ action: "update_user", ...input });
  if (data.local) {
    await db
      .update(schema.users)
      .set({
        name: input.name,
        email: input.email,
        title: input.title ?? null,
        phone: input.phone ?? null,
        avatar_initials: input.avatar_initials ?? null,
        is_admin: input.is_admin ? 1 : 0,
        is_active: input.is_active === false ? 0 : 1,
        must_change_password: input.must_change_password ? 1 : 0,
        ...(input.password ? { password: input.password } : {}),
      })
      .where(eq(schema.users.id, input.id));
    const rows = await selectUsersFallback();
    const updated = rows.find((u) => u.id === input.id);
    if (!updated) throw new Error("users.error.createFailed");
    return updated;
  }
  if (ok && data.user) return rowToUser(data.user);
  throw new Error(data.error || "users.error.updateFailed");
}

/** Sends the person a link to choose their password: "invite" (a new account, valid 7 days) or "reset" (a forgotten password, valid 1 hour). */
export async function sendUserLink(id: number, kind: "invite" | "reset", locale: string): Promise<{ sent: boolean; local?: boolean; email?: string }> {
  const { ok, data } = await postDb({ action: "send_user_link", id, kind, locale });
  if (data.local) return { sent: false, local: true };
  if (ok && data.ok) return { sent: true, email: String(data.email ?? "") };
  throw new Error(String(data.error || "users.link.failed"));
}

/**
 * Takes a person off a client. Someone who belongs to no other client is deleted with everything that was theirs (rights,
 * groups, project assignments, notebook); someone who also belongs to another client only leaves this one.
 */
export async function removeClientUser(userId: number, clientId: number): Promise<"deleted" | "unlinked"> {
  await db.delete(schema.client_users).where(and(eq(schema.client_users.user_id, userId), eq(schema.client_users.client_id, clientId)));
  await db.delete(schema.sharepoint_shares).where(and(eq(schema.sharepoint_shares.user_id, userId), eq(schema.sharepoint_shares.client_id, clientId)));
  const remaining = await db.select({ id: schema.client_users.id }).from(schema.client_users).where(eq(schema.client_users.user_id, userId));
  if (remaining.length > 0) return "unlinked";
  await db.delete(schema.user_permissions).where(eq(schema.user_permissions.user_id, userId));
  await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.user_id, userId));
  await db.delete(schema.user_clients).where(eq(schema.user_clients.user_id, userId));
  await db.delete(schema.project_members).where(eq(schema.project_members.user_id, userId));
  await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.user_id, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return "deleted";
}
