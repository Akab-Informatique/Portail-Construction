import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { DEFAULT_COMPANY } from "./invoice";
import type { CompanyProfile, EmailTemplateKey, EmailTemplates, QuickBooksSettings, SharePointSettings, SmtpSettings } from "./types";

export const SMTP_KEY = "smtp";
export const COMPANY_KEY = "company";
export const QUICKBOOKS_KEY = "quickbooks";
export const SHAREPOINT_KEY = "sharepoint";
export const EMAIL_TEMPLATES_KEY = "email_templates";

export const EMPTY_SMTP: SmtpSettings = {
  host: "",
  port: "587",
  username: "",
  password: "",
  from_name: "FRX Construction",
  from_email: "",
  secure: false,
};

export const EMPTY_QUICKBOOKS: QuickBooksSettings = {
  client_id: "",
  client_secret: "",
  realm_id: "",
  environment: "sandbox",
  connected: false,
  last_sync: null,
};

export const EMPTY_SHAREPOINT: SharePointSettings = {
  tenant_id: "",
  client_id: "",
  client_secret: "",
  site_url: "",
  drive_id: "",
  library_name: "Documents",
  connected: false,
};

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplates = {
  send_invoice: {
    key: "send_invoice",
    subject: "{kind} {number} — {company}",
    body: "Hello {client},\n\nPlease find attached {kind} {number} ({title}) for {amount}.\n\nThank you,\n{company}",
  },
  send_quote: {
    key: "send_quote",
    subject: "{kind} {number} — {company}",
    body: "Hello {client},\n\nPlease find attached {kind} {number} ({title}) for {amount}. Reply if you have questions.\n\nThank you,\n{company}",
  },
};

/**
 * Production keeps app_settings server-side (secrets are redacted on read and
 * preserved on write). Returns undefined when the server says to use the local DB.
 */
async function settingsApi(body: Record<string, unknown>): Promise<{ value?: string | null } | undefined> {
  if (!import.meta.env.PROD) return undefined;
  const res = await fetch("/api/db", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { value?: string | null; local?: boolean; error?: string };
  if (data.local) return undefined;
  if (!res.ok) throw new Error(data.error || `Settings error (${res.status})`);
  return data;
}

export async function getSetting(key: string) {
  const remote = await settingsApi({ action: "get_setting", key });
  if (remote) return remote.value ?? null;
  await dbReady;
  const rows = await db.select().from(schema.app_settings).where(eq(schema.app_settings.key, key));
  return rows[0]?.value ?? null;
}

function keepSecrets(prevRaw: string | null | undefined, nextRaw: string) {
  if (!prevRaw) return nextRaw;
  try {
    const prev = JSON.parse(prevRaw) as Record<string, unknown>;
    const next = JSON.parse(nextRaw) as Record<string, unknown>;
    for (const key of ["password", "client_secret"]) {
      if (next[key] === "********" || next[key] === "") next[key] = prev[key];
    }
    return JSON.stringify(next);
  } catch {
    return nextRaw;
  }
}

export async function setSetting(key: string, value: string) {
  if (await settingsApi({ action: "set_setting", key, value })) return;
  await dbReady;
  const existing = await db.select().from(schema.app_settings).where(eq(schema.app_settings.key, key));
  const stored = keepSecrets(existing[0]?.value, value);
  if (existing[0]) {
    await db.update(schema.app_settings).set({ value: stored }).where(eq(schema.app_settings.id, existing[0].id));
    return;
  }
  await db.insert(schema.app_settings).values({ key, value: stored });
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const raw = await getSetting(COMPANY_KEY);
  if (!raw) return { ...DEFAULT_COMPANY };
  try {
    return { ...DEFAULT_COMPANY, ...(JSON.parse(raw) as Partial<CompanyProfile>) };
  } catch {
    return { ...DEFAULT_COMPANY };
  }
}

function redactSecret<T extends Record<string, unknown>>(value: T, keys: string[]): T {
  const next = { ...value };
  for (const key of keys) {
    if (typeof next[key] === "string" && String(next[key]).length > 0) {
      (next as Record<string, unknown>)[key] = "********";
    }
  }
  return next;
}

function hasSecret(value: string | undefined) {
  return Boolean(value && value !== "********");
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const raw = await getSetting(SMTP_KEY);
  if (!raw) return { ...EMPTY_SMTP };
  try {
    return redactSecret({ ...EMPTY_SMTP, ...(JSON.parse(raw) as Partial<SmtpSettings>) }, ["password"]) as SmtpSettings;
  } catch {
    return { ...EMPTY_SMTP };
  }
}

export function smtpReady(settings: SmtpSettings) {
  return Boolean(settings.host && settings.port && settings.from_email);
}

export async function getQuickBooksSettings(): Promise<QuickBooksSettings> {
  const raw = await getSetting(QUICKBOOKS_KEY);
  if (!raw) return { ...EMPTY_QUICKBOOKS };
  try {
    return redactSecret(
      { ...EMPTY_QUICKBOOKS, ...(JSON.parse(raw) as Partial<QuickBooksSettings>) },
      ["client_secret"],
    ) as QuickBooksSettings;
  } catch {
    return { ...EMPTY_QUICKBOOKS };
  }
}

export function quickbooksReady(settings: QuickBooksSettings) {
  return Boolean(settings.client_id && (hasSecret(settings.client_secret) || settings.client_secret === "********") && settings.realm_id);
}

export async function getSharePointSettings(): Promise<SharePointSettings> {
  const raw = await getSetting(SHAREPOINT_KEY);
  if (!raw) return { ...EMPTY_SHAREPOINT };
  try {
    return redactSecret(
      { ...EMPTY_SHAREPOINT, ...(JSON.parse(raw) as Partial<SharePointSettings>) },
      ["client_secret"],
    ) as SharePointSettings;
  } catch {
    return { ...EMPTY_SHAREPOINT };
  }
}

export function sharepointReady(settings: SharePointSettings) {
  return Boolean(settings.tenant_id && settings.client_id && settings.client_secret && settings.site_url);
}

export async function getEmailTemplates(): Promise<EmailTemplates> {
  const raw = await getSetting(EMAIL_TEMPLATES_KEY);
  if (!raw) return structuredClone(DEFAULT_EMAIL_TEMPLATES);
  try {
    const parsed = JSON.parse(raw) as Partial<EmailTemplates>;
    return {
      send_invoice: { ...DEFAULT_EMAIL_TEMPLATES.send_invoice, ...parsed.send_invoice, key: "send_invoice" },
      send_quote: { ...DEFAULT_EMAIL_TEMPLATES.send_quote, ...parsed.send_quote, key: "send_quote" },
    };
  } catch {
    return structuredClone(DEFAULT_EMAIL_TEMPLATES);
  }
}

export function templateKeyForKind(kind: "invoice" | "quote"): EmailTemplateKey {
  return kind === "quote" ? "send_quote" : "send_invoice";
}

export function applyEmailTemplate(
  template: { subject: string; body: string },
  vars: Record<string, string>,
) {
  const replace = (text: string) =>
    Object.entries(vars).reduce((acc, [key, value]) => acc.split(`{${key}}`).join(value), text);
  return { subject: replace(template.subject), body: replace(template.body) };
}
