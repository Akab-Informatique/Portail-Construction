import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { deleteBillingFile } from "@/lib/billing-files";
import type { BillingFile } from "@/lib/types";

const PROJECT_TABLES = [
  schema.project_members,
  schema.project_tasks,
  schema.project_schedules,
  schema.budget_items,
  schema.calendar_events,
  schema.documents,
  schema.rfis,
  schema.change_orders,
  schema.daily_logs,
  schema.punch_items,
  schema.safety_incidents,
  schema.project_reports,
  schema.time_punches,
  schema.project_costs,
  schema.project_finance,
] as const;

async function deleteBillingFilesOf(clientId: number) {
  const files = await db.select({ id: schema.billing_files.id }).from(schema.billing_files).where(eq(schema.billing_files.client_id, clientId));
  const ids = files.map((f) => f.id);
  if (ids.length) await db.delete(schema.billing_file_blobs).where(inArray(schema.billing_file_blobs.file_id, ids));
  await db.delete(schema.billing_requests).where(eq(schema.billing_requests.client_id, clientId));
  await db.delete(schema.billing_files).where(eq(schema.billing_files.client_id, clientId));
}

export async function deleteClientCascade(clientId: number) {
  await deleteBillingFilesOf(clientId);
  await db.delete(schema.quote_changes).where(eq(schema.quote_changes.client_id, clientId));
  const projects = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.client_id, clientId));
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length) {
    const folders = await db
      .select({ id: schema.sharepoint_folders.id })
      .from(schema.sharepoint_folders)
      .where(inArray(schema.sharepoint_folders.project_id, projectIds));
    const folderIds = folders.map((f) => f.id);
    if (folderIds.length) {
      await db.delete(schema.sharepoint_shares).where(inArray(schema.sharepoint_shares.folder_id, folderIds));
    }
    await db.delete(schema.sharepoint_folders).where(inArray(schema.sharepoint_folders.project_id, projectIds));
    for (const table of PROJECT_TABLES) {
      await db.delete(table).where(inArray(table.project_id, projectIds));
    }
    await db.delete(schema.user_permissions).where(inArray(schema.user_permissions.scope_id, projectIds));
    await db.delete(schema.activities).where(inArray(schema.activities.project_id, projectIds));
    await db.delete(schema.billing_documents).where(inArray(schema.billing_documents.project_id, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.id, projectIds));
  }

  const links = await db.select().from(schema.client_users).where(eq(schema.client_users.client_id, clientId));
  const linkedUserIds = [...new Set(links.map((l) => l.user_id))];

  // The company's own groups go with it.
  const ownGroups = await db.select({ id: schema.access_groups.id }).from(schema.access_groups).where(eq(schema.access_groups.client_id, clientId));
  for (const g of ownGroups) {
    await db.delete(schema.access_group_permissions).where(eq(schema.access_group_permissions.group_id, g.id));
    await db.delete(schema.group_projects).where(eq(schema.group_projects.group_id, g.id));
    await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.group_id, g.id));
    await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.group_id, g.id));
    await db.delete(schema.access_groups).where(eq(schema.access_groups.id, g.id));
  }
  await db.delete(schema.client_users).where(eq(schema.client_users.client_id, clientId));
  await db.delete(schema.user_clients).where(eq(schema.user_clients.client_id, clientId));
  await db.delete(schema.access_group_clients).where(eq(schema.access_group_clients.client_id, clientId));
  await db.delete(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.client_id, clientId));
  await db.delete(schema.billing_documents).where(eq(schema.billing_documents.client_id, clientId));
  await db.delete(schema.activities).where(eq(schema.activities.client_id, clientId));
  await db.delete(schema.user_permissions).where(eq(schema.user_permissions.scope_id, clientId));

  for (const userId of linkedUserIds) {
    const remaining = await db.select({ id: schema.client_users.id }).from(schema.client_users).where(eq(schema.client_users.user_id, userId));
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const person = rows[0];
    if (!person) continue;
    if (person.user_type === "external" && remaining.length === 0 && !person.is_admin) {
      await db.delete(schema.user_permissions).where(eq(schema.user_permissions.user_id, userId));
      await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.user_id, userId));
      await db.delete(schema.user_clients).where(eq(schema.user_clients.user_id, userId));
      await db.delete(schema.project_members).where(eq(schema.project_members.user_id, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  }

  await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
}

/** Every table that holds rows of a single project (the same list the database uses for its project-level access rules). */
const PROJECT_ROW_TABLES = [
  "task_notes",
  "task_checklist",
  "task_dependencies",
  "note_comments",
  "project_attachments",
  "project_notes",
  "project_qrt",
  "form_entries",
  "project_members",
  "project_tasks",
  "project_schedules",
  "budget_items",
  "calendar_events",
  "documents",
  "rfis",
  "change_orders",
  "daily_logs",
  "punch_items",
  "safety_incidents",
  "project_reports",
  "time_punches",
  "project_finance",
  "project_costs",
] as const;

/** Deletes one project and everything inside it: quotes and invoices (with their files), notes, tasks, schedules and the rest. */
export async function deleteProjectCascade(projectId: number) {
  const files = await db.select().from(schema.billing_files).where(eq(schema.billing_files.project_id, projectId));
  for (const f of files.filter((x) => !x.parent_id)) await deleteBillingFile(f as BillingFile);
  // Anything left (annexes of a document that was already gone)
  const left = await db.select({ id: schema.billing_files.id }).from(schema.billing_files).where(eq(schema.billing_files.project_id, projectId));
  if (left.length) {
    const ids = left.map((f) => f.id);
    await db.delete(schema.billing_file_blobs).where(inArray(schema.billing_file_blobs.file_id, ids));
    await db.delete(schema.billing_requests).where(inArray(schema.billing_requests.file_id, ids));
    await db.delete(schema.billing_files).where(inArray(schema.billing_files.id, ids));
  }
  const folders = await db.select({ id: schema.sharepoint_folders.id }).from(schema.sharepoint_folders).where(eq(schema.sharepoint_folders.project_id, projectId));
  const folderIds = folders.map((f) => f.id);
  if (folderIds.length) await db.delete(schema.sharepoint_shares).where(inArray(schema.sharepoint_shares.folder_id, folderIds));
  await db.delete(schema.sharepoint_folders).where(eq(schema.sharepoint_folders.project_id, projectId));
  for (const name of PROJECT_ROW_TABLES) {
    const table = (schema as unknown as Record<string, { project_id: never }>)[name];
    if (table) await db.delete(table as never).where(eq(table.project_id, projectId as never));
  }
  await db.delete(schema.group_projects).where(eq(schema.group_projects.project_id, projectId));
  await db.delete(schema.user_permissions).where(and(eq(schema.user_permissions.scope_type, "project"), eq(schema.user_permissions.scope_id, projectId)));
  await db.delete(schema.billing_documents).where(eq(schema.billing_documents.project_id, projectId));
  await db.delete(schema.activities).where(eq(schema.activities.project_id, projectId));
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
}
