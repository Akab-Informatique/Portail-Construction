import {
  clientScopeOf,
  hasDatabase,
  isEffectiveAdmin,
  isInternalStaff,
  readStoredSetting,
  requireApiUser,
  serverQuery,
} from "./db.ts";
import { analyzeDocument, DEFAULT_MODELS, testConnection, writeSummary, type AiProvider, type Extracted } from "./_lib/billing-ai.ts";

/** Largest file accepted (decoded). The request body limit is 12 MB of base64. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type Req = { method?: string; body?: Record<string, unknown>; query?: Record<string, unknown>; headers?: Record<string, unknown> };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => unknown;
  setHeader: (name: string, value: string) => void;
  end: (body?: Buffer | string) => void;
};

type Mime = "application/pdf" | "image/png" | "image/jpeg";

/** Decides the real type from the first bytes, never from what the browser claims. */
function sniff(bytes: Buffer): Mime | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

const PROVIDERS: AiProvider[] = ["gemini", "anthropic"];

/** Models the provider no longer serves; an old saved value falls back to the current default. */
const RETIRED_MODELS = new Set(["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]);
const usableModel = (model: string | undefined, provider: AiProvider) =>
  model && !RETIRED_MODELS.has(model) ? model : DEFAULT_MODELS[provider];

type StoredAi = { provider?: string; api_key?: string; model?: string; enabled?: boolean };

/**
 * Which AI to use. What an admin saves in Setup → AI is the main source.
 * The server's .env (AI_PROVIDER, GEMINI_API_KEY / ANTHROPIC_API_KEY, AI_MODEL) is only a fallback when
 * Setup has no key.
 * `override` is used by local development only, where the settings live in the browser instead of the server.
 */
async function aiConfig(override?: StoredAi) {
  let stored: StoredAi = override ?? {};
  if (!override && hasDatabase()) {
    try {
      const raw = await readStoredSetting("ai");
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = {};
    }
  }
  if (stored.enabled === false) return { provider: "gemini" as AiProvider, apiKey: "", model: "" };

  const savedProvider = String(stored.provider || "").toLowerCase() as AiProvider;
  if (stored.api_key?.trim() && PROVIDERS.includes(savedProvider)) {
    return { provider: savedProvider, apiKey: stored.api_key.trim(), model: usableModel(stored.model, savedProvider) };
  }

  // Fallback: the server environment.
  const env = process.env;
  const envKeys: Record<AiProvider, string | undefined> = {
    gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
  };
  let provider = String(env.AI_PROVIDER || "").toLowerCase() as AiProvider;
  if (!PROVIDERS.includes(provider)) provider = envKeys.gemini ? "gemini" : envKeys.anthropic ? "anthropic" : "gemini";
  const apiKey = (env.AI_API_KEY || envKeys[provider] || "").trim();
  return { provider, apiKey, model: usableModel(env.AI_MODEL, provider) };
}

async function runAnalysis(kind: "invoice" | "quote" | "supplier", mime: Mime, base64: string, override?: StoredAi): Promise<{ extracted?: Extracted; error?: string }> {
  const { provider, apiKey, model } = await aiConfig(override);
  if (!apiKey) return { error: "ai.notConfigured" };
  try {
    return { extracted: await analyzeDocument({ provider, apiKey, model, mime, base64, kind }) };
  } catch (err) {
    console.error("billing analysis failed", err);
    return { error: `ai.failed|${err instanceof Error ? err.message : "?"}` };
  }
}

/**
 * FRX staff, or a real administrator. A real admin is trusted even if their session was left in "view as client" mode,
 * so a stale view switch can never lock them out of billing.
 */
function canManageBilling(user: { user_type: string; is_admin: number; view_as?: string }) {
  return Number(user.is_admin) === 1 || isInternalStaff(user);
}

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export default async function handler(req: Req, res: Res) {
  // ---- download ----
  if (req.method === "GET") {
    const user = await requireApiUser(req);
    if (!user) return res.status(401).json({ error: "billing.upload.signedOut" });
    const id = int(req.query?.id);
    if (!id) return res.status(400).json({ error: "err.badRequest" });
    const row = (await serverQuery("SELECT client_id, published, file_name, file_type FROM billing_files WHERE id = $1", [id])).rows[0] as
      | { client_id: number; published: number; file_name: string | null; file_type: string | null }
      | undefined;
    if (!row) return res.status(404).json({ error: "err.notFound" });
    const staff = canManageBilling(user);
    if (!staff) {
      const scope = await clientScopeOf(user);
      const allowed = scope === "*" || scope.split(",").includes(String(row.client_id));
      if (!allowed || Number(row.published) !== 1) return res.status(404).json({ error: "err.notFound" });
    }
    const blob = (await serverQuery("SELECT data FROM billing_file_blobs WHERE file_id = $1", [id])).rows[0] as { data: string } | undefined;
    if (!blob) return res.status(404).json({ error: "err.notFound" });
    const name = String(row.file_name || "document").replace(/[\r\n"\\/]+/g, "_");
    res.setHeader("Content-Type", row.file_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // The portal shows the file in its own page, so allow same-origin framing for this response only.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'");
    return res.status(200).end(Buffer.from(blob.data, "base64"));
  }

  if (req.method !== "POST") return res.status(405).json({ error: "err.badRequest" });
  const body = req.body ?? {};
  const action = String(body.action ?? "");

  // ---- stateless analysis (also used by local development, which has no server database) ----
  if (action === "analyze_data") {
    if (hasDatabase()) {
      const user = await requireApiUser(req);
      if (!user) return res.status(401).json({ error: "err.unauthorized" });
      if (!canManageBilling(user)) return res.status(403).json({ error: "billing.upload.forbidden" });
    }
    const bytes = Buffer.from(String(body.data ?? ""), "base64");
    const mime = sniff(bytes);
    if (!mime || bytes.length > MAX_FILE_BYTES) return res.status(400).json({ error: "billing.upload.badFile" });
    const kind = body.kind === "invoice" ? "invoice" : body.kind === "supplier" ? "supplier" : "quote";
    // Local development keeps its settings in the browser, so it sends them along; the live server never trusts this.
    const override = !hasDatabase() && body.ai && typeof body.ai === "object" ? (body.ai as StoredAi) : undefined;
    const result = await runAnalysis(kind, mime, bytes.toString("base64"), override);
    return res.status(200).json(result);
  }

  // Daily dashboard briefing: any signed-in user, written only from the facts their own dashboard sends.
  if (action === "summary") {
    let override: StoredAi | undefined;
    if (hasDatabase()) {
      const who = await requireApiUser(req);
      if (!who) return res.status(401).json({ error: "err.unauthorized" });
    } else {
      override = body.ai && typeof body.ai === "object" ? (body.ai as StoredAi) : undefined;
    }
    const facts = body.facts;
    if (!facts || typeof facts !== "object" || JSON.stringify(facts).length > 12000) return res.status(400).json({ error: "err.badRequest" });
    const { provider, apiKey, model } = await aiConfig(override);
    if (!apiKey) return res.status(200).json({ error: "ai.notConfigured" });
    try {
      const text = await writeSummary({ provider, apiKey, model, language: body.language === "en" ? "en" : "fr", facts, kind: body.kind === "project" ? "project" : body.kind === "forecast" ? "forecast" : "dashboard" });
      return res.status(200).json({ text });
    } catch (err) {
      console.error("daily summary failed", err);
      return res.status(200).json({ error: `ai.failed|${err instanceof Error ? err.message : "?"}` });
    }
  }

  // Admin check for the AI connection test (any provider/key typed in Setup).
  if (action === "ai_test") {
    let override: StoredAi | undefined;
    if (hasDatabase()) {
      const admin = await requireApiUser(req);
      if (!admin) return res.status(401).json({ error: "err.unauthorized" });
      if (!isEffectiveAdmin(admin)) return res.status(403).json({ error: "err.forbidden" });
    } else {
      override = body.ai && typeof body.ai === "object" ? (body.ai as StoredAi) : undefined;
    }
    const { provider, apiKey, model } = await aiConfig(override);
    if (!apiKey) return res.status(200).json({ error: "ai.notConfigured" });
    try {
      return res.status(200).json({ ok: true, ...(await testConnection({ provider, apiKey, model })) });
    } catch (err) {
      return res.status(200).json({ error: `ai.failed|${err instanceof Error ? err.message : "?"}` });
    }
  }

  if (!hasDatabase()) return res.status(200).json({ local: true });
  const user = await requireApiUser(req);
  if (!user) return res.status(401).json({ error: "billing.upload.signedOut" });
  // Only FRX staff manage billing files; clients can never upload or delete.
  if (!canManageBilling(user)) {
    console.warn(`billing-files: refused user ${user.id} (type ${user.user_type}, view ${user.view_as})`);
    return res.status(403).json({
      error: "billing.upload.forbidden",
      detail: `account type ${user.user_type}, admin ${Number(user.is_admin)}, view ${user.view_as ?? "?"}`,
    });
  }

  if (action === "upload") {
    const kind = body.kind === "invoice" ? "invoice" : body.kind === "quote" ? "quote" : body.kind === "supplier" ? "supplier" : null;
    const clientId = int(body.client_id);
    if (!kind || !clientId) return res.status(400).json({ error: "err.badRequest" });
    const bytes = Buffer.from(String(body.data ?? ""), "base64");
    const mime = sniff(bytes);
    if (!mime || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return res.status(400).json({ error: "billing.upload.badFile" });

    const client = (await serverQuery("SELECT id FROM clients WHERE id = $1", [clientId])).rows[0];
    if (!client) return res.status(400).json({ error: "err.notFound" });

    let parentId: number | null = int(body.parent_id);
    if (parentId) {
      const parent = (await serverQuery("SELECT kind, client_id, parent_id FROM billing_files WHERE id = $1", [parentId])).rows[0] as
        | { kind: string; client_id: number; parent_id: number | null }
        | undefined;
      // New versions and add-ons only hang off an original quote of the same client.
      if (!parent || parent.kind !== "quote" || parent.parent_id || Number(parent.client_id) !== clientId || kind !== "quote") {
        return res.status(400).json({ error: "err.badRequest" });
      }
      // Once a version is final, only add-ons are allowed; before that, only versions.
      const finals = Number(
        ((await serverQuery("SELECT count(*)::int AS n FROM billing_files WHERE (id = $1 OR parent_id = $1) AND is_final = 1 AND is_addon = 0", [parentId])).rows[0] as { n: number }).n,
      );
      if (body.addon === true && finals === 0) return res.status(400).json({ error: "billing.upload.noFinal" });
      if (body.addon !== true && finals > 0) return res.status(400).json({ error: "billing.upload.isFinal" });
    } else {
      parentId = null;
    }
    const projectId = int(body.project_id);
    const requestId = int(body.request_id);
    const fileName = String(body.file_name ?? "document").replace(/[\r\n"\\/]+/g, "_").slice(0, 200);

    const inserted = (
      await serverQuery(
        `INSERT INTO billing_files (kind, client_id, project_id, parent_id, request_id, is_addon, status, published, file_name, file_type, file_size, ai_status, uploaded_by, staff_seen)
         VALUES ($1, $2, $3, $4, $5, $6, 'sent', 0, $7, $8, $9, 'pending', $10, 1)
         RETURNING id`,
        [kind, clientId, projectId, parentId, requestId, parentId && body.addon === true ? 1 : 0, fileName, mime, bytes.length, user.id],
      )
    ).rows[0] as { id: number };
    await serverQuery("INSERT INTO billing_file_blobs (file_id, data) VALUES ($1, $2)", [inserted.id, bytes.toString("base64")]);

    const result = await runAnalysis(kind, mime, bytes.toString("base64"));
    const x = result.extracted;
    if (x) {
      await serverQuery(
        `UPDATE billing_files SET number = $2, title = $3, issued_on = $4, due_on = $5, subtotal = $6, tax_gst = $7, tax_qst = $8,
                amount = $9, ai_status = 'analyzed', ai_notes = $10 WHERE id = $1`,
        [
          inserted.id,
          x.number ?? "",
          x.title ?? "",
          x.issued_on ?? null,
          x.due_on ?? null,
          x.subtotal ?? null,
          x.tax_gst ?? null,
          x.tax_qst ?? null,
          x.total ?? 0,
          JSON.stringify({ confidence: x.confidence, notes: x.notes, client_name: x.client_name }),
        ],
      );
    } else {
      await serverQuery("UPDATE billing_files SET ai_status = $2, ai_notes = $3 WHERE id = $1", [
        inserted.id,
        result.error === "ai.notConfigured" ? "manual" : "failed",
        JSON.stringify({ error: result.error }),
      ]);
    }
    const file = (await serverQuery("SELECT * FROM billing_files WHERE id = $1", [inserted.id])).rows[0];
    return res.status(200).json({ file, extracted: x ?? null, ai_error: result.error ?? null });
  }

  if (action === "analyze") {
    const id = int(body.id);
    if (!id) return res.status(400).json({ error: "err.badRequest" });
    const row = (await serverQuery("SELECT kind, file_type FROM billing_files WHERE id = $1", [id])).rows[0] as { kind: string; file_type: string } | undefined;
    const blob = (await serverQuery("SELECT data FROM billing_file_blobs WHERE file_id = $1", [id])).rows[0] as { data: string } | undefined;
    if (!row || !blob) return res.status(404).json({ error: "err.notFound" });
    const bytes = Buffer.from(blob.data, "base64");
    const mime = sniff(bytes);
    if (!mime) return res.status(400).json({ error: "billing.upload.badFile" });
    const result = await runAnalysis(row.kind === "invoice" ? "invoice" : row.kind === "supplier" ? "supplier" : "quote", mime, blob.data);
    return res.status(200).json(result);
  }

  if (action === "delete") {
    const id = int(body.id);
    if (!id) return res.status(400).json({ error: "err.badRequest" });
    const ids = [id, ...((await serverQuery("SELECT id FROM billing_files WHERE parent_id = $1", [id])).rows as { id: number }[]).map((r) => r.id)];
    await serverQuery("DELETE FROM billing_file_blobs WHERE file_id = ANY($1::int[])", [ids]);
    await serverQuery("DELETE FROM billing_requests WHERE file_id = ANY($1::int[])", [ids]);
    await serverQuery("DELETE FROM billing_files WHERE id = ANY($1::int[])", [ids]);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "err.badRequest" });
}
