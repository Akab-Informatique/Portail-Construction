import { and, eq, inArray } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import type { SessionUser } from "./types";
import { REPORT_SECTIONS, STANDARD_REPORTS, type ReportKind, type ReportSectionId } from "./project-report";

export type ReportKey = `report:${ReportKind}` | `section:${ReportSectionId}`;

/** Every right that can be given: each standard report, the custom generator, and each chapter the generator may use. */
export const ALL_REPORT_KEYS: ReportKey[] = [
  ...STANDARD_REPORTS.map((r) => `report:${r.id}` as ReportKey),
  "report:custom",
  ...REPORT_SECTIONS.map((s) => `section:${s.id}` as ReportKey),
];

export type Subject = { type: "user" | "group"; id: number };

/** Administrators have everything. Anyone else has only what an administrator gave them, directly or through a group. */
export async function loadReportGrants(user: SessionUser | null): Promise<Set<string>> {
  if (!user || !user.is_active) return new Set();
  if (user.is_admin && user.view_as !== "client") return new Set(ALL_REPORT_KEYS);
  if (user.user_type !== "internal" || user.view_as === "client") return new Set();
  await dbReady;
  const memberships = await db.select({ group_id: schema.user_access_groups.group_id }).from(schema.user_access_groups).where(eq(schema.user_access_groups.user_id, user.id));
  const groupIds = memberships.map((m) => m.group_id);
  const rows = await db.select().from(schema.report_access);
  return new Set(rows.filter((r) => (r.subject_type === "user" && r.subject_id === user.id) || (r.subject_type === "group" && groupIds.includes(r.subject_id))).map((r) => r.report_key));
}

/** All the rights as they are stored, for the administrator's screen. */
export async function loadAllReportAccess(): Promise<Record<string, Subject[]>> {
  await dbReady;
  const rows = await db.select().from(schema.report_access);
  const out: Record<string, Subject[]> = {};
  for (const r of rows) (out[r.report_key] ??= []).push({ type: r.subject_type === "group" ? "group" : "user", id: r.subject_id });
  return out;
}

export async function addReportAccess(key: string, subject: Subject) {
  await dbReady;
  const rows = await db.select().from(schema.report_access).where(and(eq(schema.report_access.report_key, key), eq(schema.report_access.subject_type, subject.type), eq(schema.report_access.subject_id, subject.id)));
  if (rows.length) return;
  await db.insert(schema.report_access).values({ report_key: key, subject_type: subject.type, subject_id: subject.id });
}

export async function removeReportAccess(key: string, subject: Subject) {
  await dbReady;
  await db.delete(schema.report_access).where(and(eq(schema.report_access.report_key, key), eq(schema.report_access.subject_type, subject.type), eq(schema.report_access.subject_id, subject.id)));
}

/** Forget a deleted person's or group's rights. */
export async function clearReportAccessFor(type: "user" | "group", ids: number[]) {
  if (!ids.length) return;
  await db.delete(schema.report_access).where(and(eq(schema.report_access.subject_type, type), inArray(schema.report_access.subject_id, ids)));
}
