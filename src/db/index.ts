import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import * as schema from "./schema";

export { schema };

type QueryFn = (sql: string, params: unknown[]) => Promise<{ rows: unknown[][] }>;

const useRemote = import.meta.env.PROD;

async function remoteQuery(sql: string, params: unknown[]) {
  const res = await fetch("/api/db", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = (await res.json().catch(() => ({}))) as { rows?: unknown[][]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Database error (${res.status})`);
  }
  return { rows: data.rows ?? [] };
}

/**
 * Dev only: an in-browser Postgres (PGlite, persisted in IndexedDB). Loaded on
 * demand so its ~13 MB of WASM never ships in the production bundle.
 */
function createLocal() {
  const client = (async () => {
    const [{ PGlite }, { MIGRATE_SQL }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("./migrate-sql"),
    ]);
    const pg = new PGlite("idb://app-db");
    (window as any).__devs_pglite = pg;
    await pg.exec(MIGRATE_SQL);
    return pg;
  })();
  const query: QueryFn = async (sql, params) => {
    const pg = await client;
    const result = await pg.query<unknown[]>(sql, params, { rowMode: "array" });
    // Match the production API, which serializes timestamps as ISO strings.
    return {
      rows: result.rows.map((row) => row.map((cell) => (cell instanceof Date ? cell.toISOString() : cell))),
    };
  };
  return { query, ready: client.then(() => undefined) };
}

function createRemote() {
  const ready = (async () => {
    const res = await fetch("/api/db", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ping" }),
    });
    if (!res.ok) throw new Error(`Database error (${res.status})`);
  })();
  return { query: remoteQuery as QueryFn, ready };
}

const instance = useRemote ? createRemote() : createLocal();

export const db = drizzleProxy((sql, params) => instance.query(sql, params), { schema });
export const dbReady = instance.ready;
