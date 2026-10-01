import pg from "pg";
import { MIGRATE_SQL } from "../src/db/migrate-sql.ts";
import { hashPassword, hashPasswordParams, verifyPassword } from "./_lib/password.ts";
import {
  clearSessionCookie,
  cookieHeaderOf,
  newSessionToken,
  sessionCookie,
  sessionMaxAgeSeconds,
  tokenFromCookieHeader,
} from "./_lib/session.ts";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let migrated = false;
let demoReady = false;
/** null = not attempted yet, true = restricted roles active, false = setup failed (regex guards only). */
let rolesReady: boolean | null = null;

const ROLE_ADMIN = "frx_api_admin";
const ROLE_USER = "frx_api_user";
const ROLE_CLIENT = "frx_api_client";
/** Tables browser SQL may never touch; the server reads them itself. */
const PRIVATE_TABLES = ["sessions", "app_settings"];
/** Tables only effective admins may write. */
const ADMIN_TABLES = [
  "users",
  "user_permissions",
  "access_groups",
  "access_group_permissions",
  "access_group_clients",
  "user_access_groups",
  "user_clients",
  "client_users",
];
/** Columns a non-admin may change on their own users row. */
const USER_SELF_COLUMNS = ["name", "title", "phone", "avatar_initials", "locale", "theme", "tutorial_done"];
const SECRET_KEYS = ["password", "client_secret"];
const REDACTED = "********";

function statementsOf(sql: string) {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasRemoteDb() {
  return Boolean(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_PASSWORD?.trim());
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER || "frx";
  const password = process.env.POSTGRES_PASSWORD || "";
  const db = process.env.POSTGRES_DB || "frx";
  if (!password) throw new Error("POSTGRES_PASSWORD or DATABASE_URL is required");
  return `postgres://${user}:${encodeURIComponent(password)}@db:5432/${db}`;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

function serializeCell(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function ensureSchema() {
  if (migrated) return;
  const client = await getPool().connect();
  try {
    for (const statement of statementsOf(MIGRATE_SQL)) {
      await client.query(statement);
    }
    migrated = true;
  } finally {
    client.release();
  }
  await ensureApiRoles();
}

/**
 * Browser-issued SQL runs under a NOLOGIN role so Postgres itself enforces
 * access, whatever SQL the browser sends:
 *  - frx_api_admin: everything except sessions, app_settings and users.password.
 *  - frx_api_user (staff, admins previewing): business tables, read-only access
 *    tables, own profile columns only.
 *  - frx_api_client (external users): read-only, except signing/rejecting their
 *    own quotes and writing activity entries.
 * Row-level security limits staff/clients to the clients they may see; the
 * server sets frx.client_ids ('*' = all) and frx.user_id per transaction.
 */
const CLIENT_SCOPED: Record<string, string> = {
  clients: "frx_client_ok(id)",
  projects: "frx_client_ok(client_id)",
  billing_documents: "frx_client_ok(client_id)",
  client_users: "frx_client_ok(client_id)",
  sharepoint_shares: "frx_client_ok(client_id)",
};
const PROJECT_SCOPED = [
  "project_members",
  "project_tasks",
  "budget_items",
  "calendar_events",
  "documents",
  "rfis",
  "change_orders",
  "daily_logs",
  "punch_items",
  "safety_incidents",
  "project_reports",
  "sharepoint_folders",
  "time_punches",
];
const ME = "NULLIF(current_setting('frx.user_id', true), '')::int";
const ALL_CLIENTS = "(current_setting('frx.client_ids', true) = '*')";
/** Per-user rows: staff/clients only see their own permission/group/client links. */
const OWN_ROWS = ["user_permissions", "user_access_groups", "user_clients"];

function rowScopes(): Record<string, string> {
  const scopes: Record<string, string> = { ...CLIENT_SCOPED };
  for (const t of PROJECT_SCOPED) scopes[t] = "frx_project_ok(project_id)";
  scopes.activities = `(${ALL_CLIENTS} OR ((client_id IS NOT NULL OR project_id IS NOT NULL)
    AND (client_id IS NULL OR frx_client_ok(client_id))
    AND (project_id IS NULL OR frx_project_ok(project_id))))`;
  scopes.users = `(${ALL_CLIENTS} OR user_type = 'internal' OR id = ${ME}
    OR EXISTS (SELECT 1 FROM client_users cu WHERE cu.user_id = users.id AND frx_client_ok(cu.client_id)))`;
  for (const t of OWN_ROWS) scopes[t] = `(${ALL_CLIENTS} OR user_id = ${ME})`;
  // Punches are created only by the server's punch action; staff read their own.
  scopes.time_punches = `(user_id = ${ME})`;
  return scopes;
}

function policy(table: string, name: string, rest: string) {
  return [`DROP POLICY IF EXISTS ${name} ON ${table}`, `CREATE POLICY ${name} ON ${table} ${rest}`];
}

async function ensureApiRoles() {
  if (rolesReady !== null) return;
  const list = (names: string[]) => names.map((n) => `'${n}'`).join(", ");
  const publicCols = PUBLIC_USER_COLUMNS.join(", ");
  const roles = [ROLE_ADMIN, ROLE_USER, ROLE_CLIENT];
  const all = roles.join(", ");
  const scopes = rowScopes();
  const statements = [
    `DO $$ BEGIN
       ${roles.map((r) => `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF;`).join(" ")}
     END $$`,
    `GRANT ${all} TO CURRENT_USER`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${all}`,
    `GRANT USAGE ON SCHEMA public TO ${all}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${all}`,
    `DO $$ DECLARE t text; BEGIN
       FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                AND tablename NOT IN (${list([...PRIVATE_TABLES, ...ADMIN_TABLES])}) LOOP
         EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ${ROLE_ADMIN}, ${ROLE_USER}', t);
         EXECUTE format('GRANT SELECT ON %I TO ${ROLE_CLIENT}', t);
       END LOOP;
       FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                AND tablename IN (${list(ADMIN_TABLES.filter((n) => n !== "users"))}) LOOP
         EXECUTE format('GRANT SELECT ON %I TO ${ROLE_USER}, ${ROLE_CLIENT}', t);
         EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ${ROLE_ADMIN}', t);
       END LOOP;
     END $$`,
    `GRANT SELECT (${publicCols}) ON users TO ${all}`,
    `GRANT INSERT, UPDATE, DELETE ON users TO ${ROLE_ADMIN}`,
    `GRANT UPDATE (${USER_SELF_COLUMNS.join(", ")}) ON users TO ${ROLE_USER}, ${ROLE_CLIENT}`,
    `GRANT INSERT ON activities TO ${ROLE_CLIENT}`,
    `GRANT UPDATE (status, signed_by, signed_at, signature) ON billing_documents TO ${ROLE_CLIENT}`,
    `REVOKE INSERT, UPDATE, DELETE ON time_punches FROM ${ROLE_USER}`,
    `CREATE OR REPLACE FUNCTION frx_client_ok(cid integer) RETURNS boolean LANGUAGE sql STABLE AS $$
       SELECT CASE
         WHEN s = '*' THEN true
         WHEN s IS NULL OR s = '' THEN false
         ELSE cid = ANY (string_to_array(s, ',')::int[])
       END
       FROM (SELECT current_setting('frx.client_ids', true) AS s) setting
     $$`,
    `CREATE OR REPLACE FUNCTION frx_project_ok(pid integer) RETURNS boolean LANGUAGE sql STABLE AS $$
       SELECT current_setting('frx.client_ids', true) = '*'
           OR EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND frx_client_ok(p.client_id))
     $$`,
  ];
  for (const [table, scope] of Object.entries(scopes)) {
    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    statements.push(...policy(table, "frx_admin_all", `TO ${ROLE_ADMIN} USING (true) WITH CHECK (true)`));
    statements.push(...policy(table, "frx_scope_read", `FOR SELECT TO ${ROLE_USER}, ${ROLE_CLIENT} USING (${scope})`));
    if (table === "users") continue;
    for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
      const clause = cmd === "INSERT" ? `WITH CHECK (${scope})` : cmd === "DELETE" ? `USING (${scope})` : `USING (${scope}) WITH CHECK (${scope})`;
      statements.push(...policy(table, `frx_scope_${cmd.toLowerCase()}`, `FOR ${cmd} TO ${ROLE_USER} ${clause}`));
    }
  }
  // Drop the policy names used before client scoping existed.
  statements.push("DROP POLICY IF EXISTS frx_user_read ON users", "DROP POLICY IF EXISTS frx_user_self ON users");
  statements.push(
    ...policy("users", "frx_self_update", `FOR UPDATE TO ${ROLE_USER}, ${ROLE_CLIENT} USING (id = ${ME}) WITH CHECK (id = ${ME})`),
    ...policy(
      "billing_documents",
      "frx_client_decide",
      `FOR UPDATE TO ${ROLE_CLIENT} USING (kind = 'quote' AND ${scopes.billing_documents})
       WITH CHECK (kind = 'quote' AND status IN ('accepted', 'rejected') AND ${scopes.billing_documents})`,
    ),
    ...policy("activities", "frx_client_log", `FOR INSERT TO ${ROLE_CLIENT} WITH CHECK (user_id = ${ME} AND ${scopes.activities})`),
    ...policy(
      "activities",
      "frx_scope_insert",
      `FOR INSERT TO ${ROLE_USER} WITH CHECK ((user_id IS NULL OR user_id = ${ME}) AND ${scopes.activities})`,
    ),
    ...policy(
      "activities",
      "frx_scope_update",
      `FOR UPDATE TO ${ROLE_USER} USING (${scopes.activities}) WITH CHECK ((user_id IS NULL OR user_id = ${ME}) AND ${scopes.activities})`,
    ),
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) await client.query(statement);
    await client.query("COMMIT");
    rolesReady = true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    rolesReady = false;
    console.error(
      "Could not set up restricted database roles; falling back to query guards only. " +
        "The DATABASE_URL user needs CREATEROLE (the Docker default superuser has it).",
      err,
    );
  } finally {
    client.release();
  }
}

async function ensureDemoUsers() {
  if (demoReady) return;
  await ensureSchema();
  const count = await getPool().query("SELECT count(*)::int AS n FROM users");
  if ((count.rows[0]?.n ?? 0) === 0) {
    await getPool().query(
      `INSERT INTO users (name, email, password, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done)
       VALUES ($1, $2, $3, 'internal', 'Administrator', NULL, 1, 1, 'AD', 'en', 'light', 1, 1, 0)`,
      ["Administrator", "admin@frxconstruction.ca", hashPassword("admin123")],
    );
  }
  demoReady = true;
}

export async function runSql(sql: string, params: unknown[] = []) {
  await ensureSchema();
  await ensureDemoUsers();
  let text = sql;
  if (/^\s*insert\b/i.test(text) && !/\breturning\b/i.test(text)) {
    text = `${text.replace(/;+\s*$/, "")} RETURNING *`;
  }
  const result = await getPool().query({
    text,
    values: params,
    rowMode: "array",
  });
  return { rows: (result.rows as unknown[][]).map((row) => row.map(serializeCell)) };
}

/** Same column order as schema.users, with the hash blanked. */
const USERS_RETURNING =
  "id, name, email, '' AS password, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done, created_at";

/** Columns that must never leave the server, looked up by table/column OID. */
let hiddenColumns: Set<string> | null = null;
async function loadHiddenColumns() {
  if (hiddenColumns) return hiddenColumns;
  const result = await getPool().query(
    `SELECT c.oid::int AS table_id, a.attnum::int AS column_id, c.relname AS table_name
     FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND a.attnum > 0
       AND ((c.relname = 'users' AND a.attname = 'password') OR c.relname IN ('sessions', 'app_settings'))`,
  );
  hiddenColumns = new Set(result.rows.map((r) => `${r.table_id}:${r.column_id}`));
  return hiddenColumns;
}

/**
 * Runs SQL sent by the browser. With restricted roles available, the query
 * executes inside a transaction under the caller's role so Postgres enforces
 * table/column/row privileges. Output is filtered as defense in depth.
 */
type ScopedSession = { id: number; is_admin: number; user_type: string; all_clients: number; view_as?: string };

// ---- Short-lived auth cache ----
// Every API call needs the session's user and client scope. Caching them for a
// few seconds removes two database round trips per request. Anything that can
// change them (login/logout, password, user or access edits) clears the cache.
const AUTH_CACHE_MS = 5000;
const sessionCache = new Map<string, { at: number; user: Awaited<ReturnType<typeof loadSessionUserUncached>> }>();
const scopeCache = new Map<number, { at: number; ids: string }>();

export function invalidateAuthCache() {
  sessionCache.clear();
  scopeCache.clear();
}

/** Clients this session may see: "*" for all, otherwise a comma-separated id list ("" = none). */
async function allowedClientIds(session: ScopedSession) {
  if (Number(session.is_admin) === 1) return "*";
  const cached = scopeCache.get(session.id);
  if (cached && Date.now() - cached.at < AUTH_CACHE_MS) return cached.ids;
  const ids = await allowedClientIdsUncached(session);
  scopeCache.set(session.id, { at: Date.now(), ids });
  return ids;
}

async function allowedClientIdsUncached(session: ScopedSession) {
  const sql =
    session.user_type === "external"
      ? "SELECT client_id FROM client_users WHERE user_id = $1"
      : Number(session.all_clients) !== 0
        ? null
        : "SELECT client_id FROM user_clients WHERE user_id = $1";
  if (!sql) return "*";
  const result = await getPool().query(sql, [session.id]);
  return result.rows.map((r) => Number(r.client_id)).filter((n) => Number.isInteger(n)).join(",");
}

function roleFor(session: ScopedSession) {
  if (effectiveAdmin(session)) return ROLE_ADMIN;
  if (session.user_type === "external" && Number(session.is_admin) !== 1) return ROLE_CLIENT;
  return ROLE_USER;
}

async function runScopedSql(session: ScopedSession, sql: string, params: unknown[]) {
  await ensureSchema();
  await ensureDemoUsers();
  let text = sql;
  if (/^\s*insert\b/i.test(text) && !/\breturning\b/i.test(text)) {
    const intoUsers = /^\s*insert\s+into\s+"?users"?\s*\(/i.test(text);
    text = `${text.replace(/;+\s*$/, "")} RETURNING ${intoUsers ? USERS_RETURNING : "*"}`;
  }
  const hidden = await loadHiddenColumns();
  const clientIds = rolesReady ? await allowedClientIds(session) : "*";
  const client = await getPool().connect();
  try {
    if (rolesReady) {
      // One round trip. Values are server-computed integers / digit lists, safe to inline.
      const userId = String(Math.trunc(Number(session.id)));
      if (!/^(\*|[\d,]*)$/.test(clientIds)) throw new Error("bad client scope");
      await client.query(
        `RESET ROLE; BEGIN; SET LOCAL statement_timeout = '15s'; SET LOCAL ROLE ${roleFor(session)}; SELECT set_config('frx.user_id', '${userId}', true), set_config('frx.client_ids', '${clientIds}', true)`,
      );
    } else {
      await client.query("BEGIN; SET LOCAL statement_timeout = '15s'");
    }
    const result = await client.query({ text, values: params, rowMode: "array" });
    await client.query("COMMIT");
    const blank = (result.fields ?? []).map((f) => hidden.has(`${f.tableID}:${f.columnID}`));
    return {
      rows: (result.rows as unknown[][]).map((row) =>
        row.map((cell, i) => (blank[i] ? "" : serializeCell(cell))),
      ),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const DUMMY_HASH = hashPassword("frx-timing-equalizer");

export async function loginUser(email: string, password: string) {
  await ensureSchema();
  await ensureDemoUsers();
  const result = await getPool().query(
    `SELECT id, name, email, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done, created_at, password
     FROM users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email.trim()],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    // Same cost as a real check, so response time does not reveal valid e-mails.
    verifyPassword(password.trim(), DUMMY_HASH);
    return { error: "login.error.invalid" };
  }
  const stored = String(row.password ?? "");
  if (!verifyPassword(password.trim(), stored)) return { error: "login.error.invalid" };
  if (Number(row.is_active) !== 1) return { error: "login.error.inactive" };
  if (!stored.startsWith("pbkdf2$")) {
    await getPool().query("UPDATE users SET password = $2 WHERE id = $1", [row.id, hashPassword(password.trim())]);
  }
  return {
    user: {
      id: Number(row.id),
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      user_type: String(row.user_type ?? "internal"),
      title: row.title == null ? null : String(row.title),
      phone: row.phone == null ? null : String(row.phone),
      is_active: Number(row.is_active),
      is_admin: Number(row.is_admin),
      avatar_initials: row.avatar_initials == null ? null : String(row.avatar_initials),
      locale: row.locale === "fr" ? "fr" : "en",
      theme: row.theme === "dark" ? "dark" : "light",
      all_clients: Number(row.all_clients ?? 1),
      must_change_password: Number(row.must_change_password ?? 0),
      tutorial_done: Number(row.tutorial_done ?? 0),
      created_at: row.created_at,
      password: "",
    },
  };
}

const PUBLIC_USER_COLUMNS = [
  "id",
  "name",
  "email",
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

function publicUser(row: unknown) {
  const data = Array.isArray(row)
    ? Object.fromEntries(PUBLIC_USER_COLUMNS.map((key, i) => [key, row[i]]))
    : ((row ?? {}) as Record<string, unknown>);
  return {
    id: Number(data.id),
    name: String(data.name ?? ""),
    email: String(data.email ?? ""),
    user_type: String(data.user_type ?? "internal"),
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
    created_at: data.created_at,
    password: "",
  };
}

async function createDbSession(userId: number) {
  const token = newSessionToken();
  const expires = new Date(Date.now() + sessionMaxAgeSeconds() * 1000).toISOString();
  await getPool().query("DELETE FROM sessions WHERE expires_at < $1", [new Date().toISOString()]);
  await getPool().query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    userId,
    expires,
  ]);
  return token;
}

async function revokeDbSession(token: string | null) {
  if (!token) return;
  await getPool().query("DELETE FROM sessions WHERE token = $1", [token]);
  invalidateAuthCache();
}

async function revokeUserSessions(userId: number) {
  await getPool().query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  invalidateAuthCache();
}

async function loadSessionUser(req: { headers?: Record<string, unknown> }) {
  const token = tokenFromCookieHeader(cookieHeaderOf(req));
  if (!token) return null;
  const cached = sessionCache.get(token);
  if (cached && Date.now() - cached.at < AUTH_CACHE_MS) return cached.user ? { ...cached.user } : null;
  const user = await loadSessionUserUncached(token);
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { at: Date.now(), user });
  return user ? { ...user } : null;
}

async function loadSessionUserUncached(token: string) {
  const result = await getPool().query(
    `SELECT u.id, u.name, u.email, u.user_type, u.title, u.phone, u.is_active, u.is_admin,
            u.avatar_initials, u.locale, u.theme, u.all_clients, u.must_change_password, u.tutorial_done, u.created_at, s.expires_at,
            COALESCE(s.view_as, 'admin') AS view_as
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || Number(row.is_active) !== 1) return null;
  if (String(row.expires_at) < new Date().toISOString()) {
    await revokeDbSession(token);
    return null;
  }
  const user = publicUser(row) as ReturnType<typeof publicUser> & { view_as?: string };
  user.view_as = String(row.view_as ?? "admin");
  return user;
}

function effectiveAdmin(session: { is_admin: number; view_as?: string }) {
  return Number(session.is_admin) === 1 && (session.view_as ?? "admin") === "admin";
}

/** Upper bounds for browser-issued SQL (Drizzle's largest app queries are a few KB). */
export const MAX_SQL_CHARS = 20_000;
export const MAX_SQL_PARAMS = 2_000;

function isAllowedSql(sql: string) {
  const trimmed = sql.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_SQL_CHARS) return false;
  // The app only touches its own tables. System catalogs/views (pg_settings can
  // change session settings), information_schema and large objects are off-limits.
  if (/\b(pg_\w+|information_schema|lo_\w+|current_user|session_user|current_role|txid_\w+)\b/i.test(trimmed)) return false;
  if (/;/.test(trimmed.replace(/;+\s*$/, ""))) return false;
  if (/\b(drop|alter|truncate|create|grant|revoke|comment|copy|vacuum|lock|call|do)\b/i.test(trimmed)) return false;
  // Unicode-escaped identifiers/strings could smuggle names past the checks below.
  if (/\bu&\s*["']/i.test(trimmed)) return false;
  // Server-only tables and functions that change session state or touch the server.
  if (new RegExp(`\\b(${PRIVATE_TABLES.join("|")})\\b`, "i").test(trimmed)) return false;
  if (
    /\b(set_config|current_setting|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink\w*|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|query_to_xml\w*|table_to_xml\w*|database_to_xml\w*)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (/^\s*select\b/i.test(trimmed)) return true;
  if (/^\s*insert\s+into\b/i.test(trimmed)) return true;
  if (/^\s*update\b/i.test(trimmed)) return true;
  if (/^\s*delete\s+from\b/i.test(trimmed)) return true;
  return false;
}

// Whole identifier only, so "must_change_password" is left alone.
const PASSWORD_COLUMN = /(?<![\w$"])(?:(?:"users"|users)\.)?(?:"password"|password(?![\w$"]))(?!\s*=)/gi;

/**
 * Drizzle selects every column, including users.password. Swap it for an empty
 * literal so the query still returns the expected shape without needing (or
 * leaking) the hash. Only touches the select list / RETURNING clause.
 */
function rewriteSql(sql: string) {
  if (!/\busers\b/i.test(sql)) return sql;
  if (/^\s*select\b/i.test(sql)) return sql.replace(PASSWORD_COLUMN, "'' AS password");
  const returning = sql.search(/\breturning\b/i);
  if (returning >= 0) {
    return sql.slice(0, returning) + sql.slice(returning).replace(PASSWORD_COLUMN, "'' AS password");
  }
  return sql;
}

/** Fallback guard when DB roles are unavailable: a non-admin may only update their own users row. */
function updatesOnlyOwnRow(sql: string, params: unknown[], userId: number) {
  const m = sql.match(/\bwhere\s+(?:"?users"?\.)?"?id"?\s*=\s*\$(\d+)\s*$/i);
  if (!m) return false;
  return Number(params[Number(m[1]) - 1]) === userId;
}

// ---- Login throttling (in-memory, per process) ----
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
/** Per address, across all accounts (password spraying). */
const LOGIN_MAX_FAILURES_PER_IP = 50;
const loginFailures = new Map<string, { count: number; first: number }>();

function loginBlocked(key: string, max = LOGIN_MAX_FAILURES) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= max;
}

function recordLoginFailure(key: string) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 10_000) {
    const cutoff = Date.now() - LOGIN_WINDOW_MS;
    for (const [k, v] of loginFailures) if (v.first < cutoff) loginFailures.delete(k);
  }
}

// ---- app_settings (server-side so secrets never reach the browser) ----
function redactSettingValue(raw: string | null) {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
    const next = { ...(parsed as Record<string, unknown>) };
    for (const key of SECRET_KEYS) {
      if (typeof next[key] === "string" && next[key]) next[key] = REDACTED;
    }
    return JSON.stringify(next);
  } catch {
    return raw;
  }
}

function keepStoredSecrets(prevRaw: string | null, nextRaw: string) {
  if (!prevRaw) return nextRaw;
  try {
    const prev = JSON.parse(prevRaw) as Record<string, unknown>;
    const next = JSON.parse(nextRaw) as Record<string, unknown>;
    if (!next || typeof next !== "object" || Array.isArray(next)) return nextRaw;
    for (const key of SECRET_KEYS) {
      if (next[key] === REDACTED || next[key] === "" || next[key] === undefined) {
        if (prev && typeof prev === "object" && key in prev) next[key] = prev[key];
      }
    }
    return JSON.stringify(next);
  } catch {
    return nextRaw;
  }
}

/** Reads a raw (unredacted) setting. Server-side use only. */
export async function readStoredSetting(key: string) {
  await ensureSchema();
  const result = await getPool().query("SELECT value FROM app_settings WHERE key = $1 ORDER BY id ASC LIMIT 1", [key]);
  const value = result.rows[0]?.value;
  return typeof value === "string" ? value : null;
}

export function isEffectiveAdmin(session: { is_admin: number; view_as?: string }) {
  return effectiveAdmin(session);
}

export function isInternalStaff(session: { user_type: string; view_as?: string }) {
  return session.user_type === "internal" && session.view_as !== "client";
}

/** Session for the other API routes; a user who must change their password gets nothing else. */
export async function requireApiUser(req: { headers?: Record<string, unknown> }) {
  await ensureSchema();
  const session = await loadSessionUser(req);
  if (!session || Number(session.must_change_password) === 1) return null;
  return session;
}

function parsedBody(req: { body?: any }) {
  const raw = req.body;
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}


// ---- Time punches (server-authoritative: time, state and site rule) ----
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

function finiteOrNull(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

const PUNCH_COLUMNS =
  "id, user_id, project_id, kind, punched_at, lat, lng, accuracy, distance_m, status, note, created_at";

async function recordPunch(session: ScopedSession, body: Record<string, unknown>) {
  const kind = body.kind === "out" ? "out" : body.kind === "in" ? "in" : null;
  if (!kind) return { error: "punch.error.failed" };
  const last = (
    await getPool().query(
      `SELECT ${PUNCH_COLUMNS} FROM time_punches WHERE user_id = $1 ORDER BY punched_at DESC, id DESC LIMIT 1`,
      [session.id],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  const openPunch = last?.kind === "in" ? last : null;
  if (kind === "in" && openPunch) return { error: "punch.error.alreadyIn", open: openPunch };
  if (kind === "out" && !openPunch) return { error: "punch.error.notIn" };

  // Checking out always closes the shift that is open, whatever the screen sent.
  const projectId = kind === "out" ? Number(openPunch!.project_id) : Number(body.project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) return { error: "punch.error.noProject" };
  const project = (
    await getPool().query(
      "SELECT id, client_id, require_geofence, geo_lat, geo_lng, geo_radius_m FROM projects WHERE id = $1",
      [projectId],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (!project) return { error: "punch.error.noProject" };
  const allowed = await allowedClientIds(session);
  if (allowed !== "*" && !allowed.split(",").includes(String(project.client_id)) && kind === "in") {
    return { error: "punch.error.noProject" };
  }

  const lat = finiteOrNull(body.lat);
  const lng = finiteOrNull(body.lng);
  const accuracy = finiteOrNull(body.accuracy);
  let distance: number | null = null;
  let status = "ok";
  if (Number(project.require_geofence) === 1) {
    const siteLat = finiteOrNull(project.geo_lat);
    const siteLng = finiteOrNull(project.geo_lng);
    const radius = Number(project.geo_radius_m) > 0 ? Number(project.geo_radius_m) : 200;
    if (siteLat !== null && siteLng !== null && lat !== null && lng !== null) {
      distance = haversineMeters({ lat, lng }, { lat: siteLat, lng: siteLng });
    }
    if (kind === "in") {
      // The site rule gates checking in only.
      if (siteLat === null || siteLng === null) return { error: "punch.error.noPin" };
      if (lat === null || lng === null) return { error: "punch.error.needLocation" };
      if (distance !== null && distance > radius) {
        return { error: "punch.error.outside", distance, radius, accuracy: accuracy === null ? null : Math.round(accuracy) };
      }
    } else {
      // Checking out is never blocked, so a shift cannot keep running after the
      // worker leaves; it is flagged for review instead.
      status = distance === null ? "no_location" : distance > radius ? "offsite" : "ok";
    }
  } else if (lat !== null && lng !== null) {
    const siteLat = finiteOrNull(project.geo_lat);
    const siteLng = finiteOrNull(project.geo_lng);
    if (siteLat !== null && siteLng !== null) distance = haversineMeters({ lat, lng }, { lat: siteLat, lng: siteLng });
  }

  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const inserted = await getPool().query(
    `INSERT INTO time_punches (user_id, project_id, kind, punched_at, lat, lng, accuracy, distance_m, status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${PUNCH_COLUMNS}`,
    [session.id, projectId, kind, new Date().toISOString(), lat, lng, accuracy, distance, status, note],
  );
  return { punch: inserted.rows[0] };
}

const AUTH_ACTIONS = new Set([
  "login",
  "logout",
  "create_user",
  "update_user",
  "change_password",
  "complete_tutorial",
  "set_tutorial",
  "view_as",
]);

export async function handleDbRequest(req: { method?: string; body?: any; headers?: Record<string, unknown>; query?: Record<string, unknown>; url?: string }, res: any) {
  const body = parsedBody(req);
  req.body = body;
  const urlAction = (() => {
    try {
      const q = new URL(String(req.url || ""), "http://local").searchParams.get("action");
      return q || "";
    } catch {
      return "";
    }
  })();
  const action = String(body.action ?? req.query?.action ?? urlAction ?? "");
  // Clear cached sessions/scopes after anything that can change who a user is
  // or what they may see.
  const changesAuth =
    AUTH_ACTIONS.has(action) ||
    (typeof body.sql === "string" &&
      /^\s*(insert|update|delete)\b/i.test(body.sql) &&
      /\b(users|sessions|client_users|user_clients)\b/i.test(body.sql));
  try {
    if (action === "ping" || req.method === "GET") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ ok: true, users: 0, local: true });
      }
      await ensureSchema();
      await ensureDemoUsers();
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (action === "login") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ error: "login.local" });
      }
      const email = String(req.body?.email ?? "");
      const throttleKey = email.trim().toLowerCase();
      const clientIp = String(req.headers?.["x-client-ip"] ?? "");
      const ipKey = clientIp ? `ip:${clientIp}` : "";
      if (loginBlocked(throttleKey) || (ipKey && loginBlocked(ipKey, LOGIN_MAX_FAILURES_PER_IP))) {
        return res.status(429).json({ error: "login.error.throttled" });
      }
      const result = await loginUser(email, String(req.body?.password ?? ""));
      if ("user" in result && result.user) {
        loginFailures.delete(throttleKey);
        const token = await createDbSession(Number(result.user.id));
        res.setHeader?.("Set-Cookie", sessionCookie(token));
      } else {
        recordLoginFailure(throttleKey);
        if (ipKey) recordLoginFailure(ipKey);
      }
      return res.status(200).json(result);
    }
    if (action === "logout") {
      if (hasRemoteDb()) await revokeDbSession(tokenFromCookieHeader(cookieHeaderOf(req)));
      res.setHeader?.("Set-Cookie", clearSessionCookie());
      return res.status(200).json({ ok: true });
    }
    if (action === "session") {
      if (!hasRemoteDb()) return res.status(200).json({ user: null, local: true });
      await ensureSchema();
      const user = await loadSessionUser(req);
      return res.status(200).json({ user });
    }
    if (action === "list_users") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ users: [], local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (Number(session.must_change_password) === 1) {
        res.status(403).json({ error: "password_change_required" });
        return;
      }
      if (Number(session.is_admin) !== 1) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      await ensureSchema();
      const result = await getPool().query(
        `SELECT id, name, email, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, created_at
         FROM users
         ORDER BY id ASC`,
      );
      return res.status(200).json({
        users: (result.rows as Record<string, unknown>[]).map((row) => publicUser(row)),
      });
    }
    if (action === "create_user") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (Number(session.must_change_password) === 1) {
        res.status(403).json({ error: "password_change_required" });
        return;
      }
      if (Number(session.is_admin) !== 1) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const name = String(req.body?.name ?? "").trim();
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      const userType = req.body?.user_type === "external" ? "external" : "internal";
      const title = String(req.body?.title ?? "").trim() || null;
      const phone = String(req.body?.phone ?? "").trim() || null;
      const isAdmin = userType === "internal" && Boolean(req.body?.is_admin) ? 1 : 0;
      const groupIds = Array.isArray(req.body?.groupIds)
        ? req.body.groupIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
        : [];
      if (!name || !email || !password) {
        res.status(400).json({ error: "Name, email, and password are required" });
        return;
      }
      const existing = await getPool().query("SELECT id FROM users WHERE lower(email) = $1 LIMIT 1", [email]);
      if (existing.rows[0]) {
        res.status(409).json({ error: "A user with this email already exists." });
        return;
      }
      const storedPassword = password.startsWith("pbkdf2$") ? password : hashPassword(password);
      const mustChange = req.body?.must_change_password === false ? 0 : 1;
      const inserted = await getPool().query(
        `INSERT INTO users (name, email, password, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, 'en', 'light', $9, $10, 0)
         RETURNING id, name, email, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done, created_at`,
        [
          name,
          email,
          storedPassword,
          userType,
          title,
          phone,
          isAdmin,
          String(req.body?.avatar_initials ?? name).slice(0, 2).toUpperCase(),
          userType === "external" ? 0 : 1,
          mustChange,
        ],
      );
      const created = publicUser(inserted.rows[0] as Record<string, unknown>);
      for (const groupId of groupIds) {
        await getPool().query("INSERT INTO user_access_groups (user_id, group_id) VALUES ($1, $2)", [
          created.id,
          groupId,
        ]);
      }
      return res.status(200).json({ user: created });
    }
    if (action === "update_user") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (Number(session.must_change_password) === 1) {
        res.status(403).json({ error: "password_change_required" });
        return;
      }
      if (Number(session.is_admin) !== 1) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const id = Number(req.body?.id);
      const name = String(req.body?.name ?? "").trim();
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      if (!id || !name || !email) {
        res.status(400).json({ error: "Name and email are required" });
        return;
      }
      const title = String(req.body?.title ?? "").trim() || null;
      const phone = String(req.body?.phone ?? "").trim() || null;
      const isAdmin = Boolean(req.body?.is_admin) ? 1 : 0;
      const isActive = req.body?.is_active === false ? 0 : 1;
      const mustChange = req.body?.must_change_password ? 1 : 0;
      const avatar = String(req.body?.avatar_initials ?? name).slice(0, 2).toUpperCase();
      const password = String(req.body?.password ?? "");
      if (password) {
        const storedPassword = password.startsWith("pbkdf2$") ? password : hashPassword(password);
        await getPool().query(
          `UPDATE users SET name=$2, email=$3, title=$4, phone=$5, is_admin=$6, is_active=$7, avatar_initials=$8, must_change_password=$9, password=$10 WHERE id=$1`,
          [id, name, email, title, phone, isAdmin, isActive, avatar, mustChange, storedPassword],
        );
      } else {
        await getPool().query(
          `UPDATE users SET name=$2, email=$3, title=$4, phone=$5, is_admin=$6, is_active=$7, avatar_initials=$8, must_change_password=$9 WHERE id=$1`,
          [id, name, email, title, phone, isAdmin, isActive, avatar, mustChange],
        );
      }
      if (password || isActive === 0) await revokeUserSessions(id);
      const updated = await getPool().query(
        `SELECT id, name, email, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done, created_at FROM users WHERE id=$1`,
        [id],
      );
      return res.status(200).json({ user: publicUser(updated.rows[0]) });
    }
    if (action === "change_password") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const current = String(req.body?.current ?? "");
      const next = String(req.body?.next ?? "");
      if (next.trim().length < 8) {
        res.status(400).json({ error: "profile.passwordShort" });
        return;
      }
      const row = await getPool().query(`SELECT id, password FROM users WHERE id=$1 LIMIT 1`, [session.id]);
      const stored = String(row.rows[0]?.password ?? "");
      if (!verifyPassword(current, stored)) {
        res.status(400).json({ error: "profile.passwordWrong" });
        return;
      }
      await getPool().query(`UPDATE users SET password=$2, must_change_password=0 WHERE id=$1`, [
        session.id,
        hashPassword(next),
      ]);
      const currentToken = tokenFromCookieHeader(cookieHeaderOf(req));
      await getPool().query("DELETE FROM sessions WHERE user_id = $1 AND token <> $2", [session.id, currentToken ?? ""]);
      return res.status(200).json({ ok: true });
    }
    if (action === "complete_tutorial" || action === "set_tutorial") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const done =
        action === "complete_tutorial"
          ? 1
          : Number(req.body?.tutorial_done ?? req.body?.done ?? 1) ? 1 : 0;
      await getPool().query(`UPDATE users SET tutorial_done=$2 WHERE id=$1`, [session.id, done]);
      return res.status(200).json({ ok: true, tutorial_done: done });
    }
    if (action === "view_as") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ ok: true, view_as: String(req.body?.view_as ?? "admin"), local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (Number(session.must_change_password) === 1) {
        res.status(403).json({ error: "password_change_required" });
        return;
      }
      if (Number(session.is_admin) !== 1) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const mode = String(req.body?.view_as ?? "admin");
      const viewAs = mode === "staff" || mode === "client" ? mode : "admin";
      const token = tokenFromCookieHeader(cookieHeaderOf(req));
      if (token) {
        await getPool().query("UPDATE sessions SET view_as = $2 WHERE token = $1", [token, viewAs]);
      }
      return res.status(200).json({ ok: true, view_as: viewAs });
    }
    if (action === "punch") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (Number(session.must_change_password) === 1) {
        res.status(403).json({ error: "password_change_required" });
        return;
      }
      if (session.user_type !== "internal") {
        return res.status(403).json({ error: "punch.error.notStaff" });
      }
      return res.status(200).json(await recordPunch(session, req.body ?? {}));
    }
    if (action === "get_setting" || action === "set_setting") {
      if (!hasRemoteDb()) {
        return res.status(200).json({ local: true });
      }
      const session = await loadSessionUser(req);
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (Number(session.must_change_password) === 1) {
        res.status(403).json({ error: "password_change_required" });
        return;
      }
      const key = String(req.body?.key ?? "").trim();
      if (!key) {
        res.status(400).json({ error: "key is required" });
        return;
      }
      const stored = await readStoredSetting(key);
      if (action === "get_setting") {
        // Clients never need the mail or accounting integration settings.
        const staffOnly = key === "smtp" || key === "quickbooks";
        if (staffOnly && (session.user_type === "external" || session.view_as === "client") && !effectiveAdmin(session)) {
          return res.status(200).json({ value: null });
        }
        if (key === "sharepoint" && stored && session.user_type === "external") {
          try {
            const sp = JSON.parse(stored) as Record<string, unknown>;
            const on = Boolean(sp.tenant_id && sp.client_id && sp.site_url);
            return res.status(200).json({
              value: JSON.stringify(
                on
                  ? { tenant_id: "configured", client_id: "configured", site_url: "configured", drive_id: sp.drive_id ?? "", library_name: sp.library_name ?? "" }
                  : {},
              ),
            });
          } catch {
            return res.status(200).json({ value: null });
          }
        }
        return res.status(200).json({ value: redactSettingValue(stored) });
      }
      if (!effectiveAdmin(session)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const value = keepStoredSecrets(stored, String(req.body?.value ?? ""));
      if (stored === null) {
        await getPool().query("INSERT INTO app_settings (key, value) VALUES ($1, $2)", [key, value]);
      } else {
        await getPool().query("UPDATE app_settings SET value = $2 WHERE key = $1", [key, value]);
      }
      return res.status(200).json({ ok: true });
    }
    if (!hasRemoteDb()) {
      return res.status(200).json({ rows: [], local: true });
    }
    const session = await loadSessionUser(req);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (Number(session.must_change_password) === 1) {
      res.status(403).json({ error: "password_change_required" });
      return;
    }
    const sql = String(req.body?.sql ?? "");
    const params = Array.isArray(req.body?.params) ? req.body.params : [];
    if (!sql.trim()) {
      res.status(400).json({ error: "sql is required" });
      return;
    }
    if (sql.length > MAX_SQL_CHARS || params.length > MAX_SQL_PARAMS) {
      res.status(413).json({ error: "Query too large" });
      return;
    }
    if (!isAllowedSql(sql)) {
      res.status(400).json({ error: "Query not allowed" });
      return;
    }
    const mutating = /^\s*(insert|update|delete)\b/i.test(sql);
    const sensitive = new RegExp(`\\b(${ADMIN_TABLES.join("|")})\\b`, "i").test(sql);
    const admin = effectiveAdmin(session);
    if (mutating && sensitive && !admin) {
      // Mirrors the database policy for when roles are unavailable.
      const setClause = sql.match(/^\s*update\s+"?users"?\s+set\s+([\s\S]+?)\s+where\b/i)?.[1] ?? "";
      const setColumns = [...setClause.matchAll(/"?(\w+)"?\s*=/g)].map((m) => m[1].toLowerCase());
      const selfProfile =
        setColumns.length > 0 &&
        setColumns.every((col) => USER_SELF_COLUMNS.includes(col)) &&
        updatesOnlyOwnRow(sql, params, session.id);
      if (!selfProfile) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    if (mutating && /^\s*update\s+"?users"?/i.test(sql) && /(?<![\w$])"?(password|is_active)"?\s*=/i.test(sql)) {
      const target = sql.match(/\bwhere\s+(?:"?users"?\.)?"?id"?\s*=\s*\$(\d+)\s*$/i);
      const targetId = target ? Number(params[Number(target[1]) - 1]) : NaN;
      if (Number.isInteger(targetId) && targetId !== session.id) await revokeUserSessions(targetId);
    }
    const { rows } = await runScopedSql(session, rewriteSql(sql), await hashPasswordParams(sql, params));
    res.status(200).json({ rows });
  } catch (err) {
    console.error("db api error", err);
    res.status(500).json({ error: "Query failed" });
  } finally {
    if (changesAuth) invalidateAuthCache();
  }
}

export default async function handler(req: any, res: any) {
  await handleDbRequest(req, res);
}
