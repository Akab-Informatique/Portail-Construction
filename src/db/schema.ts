import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  password: text("password").notNull(),
  user_type: text("user_type").notNull(),
  title: text("title"),
  phone: text("phone"),
  is_active: integer("is_active").notNull(),
  is_admin: integer("is_admin").notNull(),
  avatar_initials: text("avatar_initials"),
  locale: text("locale").notNull(),
  theme: text("theme").notNull(),
  all_clients: integer("all_clients").notNull().default(1),
  must_change_password: integer("must_change_password").notNull().default(0),
  tutorial_done: integer("tutorial_done").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company_name: text("company_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  notes: text("notes"),
  status: text("status").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const client_users = pgTable("client_users", {
  id: serial("id").primaryKey(),
  client_id: integer("client_id").notNull(),
  user_id: integer("user_id").notNull(),
  is_primary: integer("is_primary").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  client_id: integer("client_id").notNull(),
  name: text("name").notNull(),
  project_number: text("project_number").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  project_type: text("project_type"),
  address: text("address"),
  city: text("city"),
  start_date: text("start_date"),
  end_date: text("end_date"),
  budget: real("budget").notNull(),
  spent: real("spent").notNull(),
  sort_order: integer("sort_order").notNull(),
  geo_lat: real("geo_lat"),
  geo_lng: real("geo_lng"),
  geo_radius_m: integer("geo_radius_m"),
  require_geofence: integer("require_geofence").notNull().default(0),
  color: text("color"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const board_columns = pgTable("board_columns", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  sort_order: integer("sort_order").notNull(),
  is_system: integer("is_system").notNull(),
  color: text("color").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const project_members = pgTable("project_members", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  user_id: integer("user_id").notNull(),
  role: text("role").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const user_permissions = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  module: text("module").notNull(),
  scope_type: text("scope_type").notNull(),
  scope_id: integer("scope_id").notNull(),
  can_view: integer("can_view").notNull(),
  can_create: integer("can_create").notNull(),
  can_edit: integer("can_edit").notNull(),
  can_delete: integer("can_delete").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const project_tasks = pgTable("project_tasks", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  start_date: text("start_date"),
  end_date: text("end_date"),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  assigned_to: integer("assigned_to"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const budget_items = pgTable("budget_items", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  estimated: real("estimated").notNull(),
  actual: real("actual").notNull(),
  status: text("status").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const calendar_events = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  title: text("title").notNull(),
  event_date: text("event_date").notNull(),
  end_date: text("end_date"),
  event_type: text("event_type").notNull(),
  description: text("description"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  notes: text("notes"),
  uploaded_by: integer("uploaded_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const sharepoint_folders = pgTable("sharepoint_folders", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  name: text("name").notNull(),
  sp_item_id: text("sp_item_id").notNull(),
  sp_drive_id: text("sp_drive_id").notNull(),
  path: text("path").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const sharepoint_shares = pgTable("sharepoint_shares", {
  id: serial("id").primaryKey(),
  folder_id: integer("folder_id").notNull(),
  client_id: integer("client_id").notNull(),
  item_id: text("item_id").notNull().default(""),
  /** null = the whole company; a user id = a right for that client user only (added on top of the company's). */
  user_id: integer("user_id"),
  can_view: integer("can_view").notNull(),
  can_upload: integer("can_upload").notNull(),
  can_edit: integer("can_edit").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const rfis = pgTable("rfis", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  number: text("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  assigned_to: integer("assigned_to"),
  due_date: text("due_date"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const change_orders = pgTable("change_orders", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  number: text("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  amount: real("amount").notNull(),
  status: text("status").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const daily_logs = pgTable("daily_logs", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  log_date: text("log_date").notNull(),
  weather: text("weather"),
  crew_count: integer("crew_count").notNull(),
  notes: text("notes"),
  created_by: integer("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const punch_items = pgTable("punch_items", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  assigned_to: integer("assigned_to"),
  due_date: text("due_date"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const safety_incidents = pgTable("safety_incidents", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  incident_date: text("incident_date").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  incident_type: text("incident_type"),
  location: text("location"),
  people_involved: text("people_involved"),
  immediate_action: text("immediate_action"),
  corrective_action: text("corrective_action"),
  reported_by: integer("reported_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const project_reports = pgTable("project_reports", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  name: text("name").notNull(),
  sections: text("sections").notNull(),
  created_by: integer("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id"),
  client_id: integer("client_id"),
  user_id: integer("user_id"),
  action: text("action").notNull(),
  details: text("details"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const access_groups = pgTable("access_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  audience: text("audience").notNull(),
  all_clients: integer("all_clients").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const access_group_permissions = pgTable("access_group_permissions", {
  id: serial("id").primaryKey(),
  group_id: integer("group_id").notNull(),
  module: text("module").notNull(),
  can_view: integer("can_view").notNull(),
  can_create: integer("can_create").notNull(),
  can_edit: integer("can_edit").notNull(),
  can_delete: integer("can_delete").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const access_group_clients = pgTable("access_group_clients", {
  id: serial("id").primaryKey(),
  group_id: integer("group_id").notNull(),
  client_id: integer("client_id").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const user_access_groups = pgTable("user_access_groups", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  group_id: integer("group_id").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const user_clients = pgTable("user_clients", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  client_id: integer("client_id").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const billing_documents = pgTable("billing_documents", {
  id: serial("id").primaryKey(),
  client_id: integer("client_id").notNull(),
  project_id: integer("project_id"),
  kind: text("kind").notNull(),
  number: text("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  amount: real("amount").notNull(),
  status: text("status").notNull(),
  issued_on: text("issued_on"),
  due_on: text("due_on"),
  notes: text("notes"),
  source_quote_id: integer("source_quote_id"),
  line_items: text("line_items"),
  subtotal: real("subtotal"),
  tax_gst: real("tax_gst"),
  tax_qst: real("tax_qst"),
  po_number: text("po_number"),
  sent_at: text("sent_at"),
  sent_to: text("sent_to"),
  signed_by: text("signed_by"),
  signed_at: text("signed_at"),
  signature: text("signature"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** Client change requests and the priced annexes (add-ons) that go with a quote. */
export const quote_changes = pgTable("quote_changes", {
  id: serial("id").primaryKey(),
  quote_id: integer("quote_id").notNull(),
  client_id: integer("client_id").notNull(),
  number: text("number").notNull(),
  /** "client" = asked for by the client, "staff" = added by FRX. */
  origin: text("origin").notNull(),
  /** requested -> proposed (annex priced, waiting on the client) -> approved | rejected, or cancelled. */
  status: text("status").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  line_items: text("line_items"),
  subtotal: real("subtotal"),
  tax_gst: real("tax_gst"),
  tax_qst: real("tax_qst"),
  amount: real("amount").notNull().default(0),
  requested_by: integer("requested_by"),
  requested_at: text("requested_at"),
  proposed_by: integer("proposed_by"),
  proposed_at: text("proposed_at"),
  decided_by: integer("decided_by"),
  decided_at: text("decided_at"),
  signed_by: text("signed_by"),
  signature: text("signature"),
  /** 0 = FRX staff have not looked at this yet (drives the notification bubble). */
  staff_seen: integer("staff_seen").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Invoices and quotes uploaded as files ("Gestion de la facturation"). The amounts are read from the file
 * (by AI, then confirmed by staff) and are for consultation only. A row with parent_id is an annex (sub-file)
 * of the original quote and counts toward it once the client accepts it.
 */
export const billing_files = pgTable("billing_files", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  client_id: integer("client_id").notNull(),
  project_id: integer("project_id"),
  parent_id: integer("parent_id"),
  request_id: integer("request_id"),
  number: text("number").notNull().default(""),
  title: text("title").notNull().default(""),
  description: text("description"),
  subtotal: real("subtotal"),
  tax_gst: real("tax_gst"),
  tax_qst: real("tax_qst"),
  amount: real("amount").notNull().default(0),
  issued_on: text("issued_on"),
  due_on: text("due_on"),
  status: text("status").notNull().default("sent"),
  /** 1 = this version of the quote is the final approved one: no more versions, only add-ons from then on. */
  is_final: integer("is_final").notNull().default(0),
  /** 1 = an add-on to the final quote (its amount is added to the quote once the client accepts it). */
  is_addon: integer("is_addon").notNull().default(0),
  /** 0 until staff confirm the extracted data; clients only ever see published rows. */
  published: integer("published").notNull().default(0),
  file_name: text("file_name"),
  file_type: text("file_type"),
  file_size: integer("file_size"),
  /** pending | analyzed | manual | failed */
  ai_status: text("ai_status").notNull().default("manual"),
  ai_notes: text("ai_notes"),
  uploaded_by: integer("uploaded_by"),
  accepted_by: text("accepted_by"),
  accepted_at: text("accepted_at"),
  signature: text("signature"),
  /** 0 = staff have not seen the client's decision yet (drives the notification bubble). */
  staff_seen: integer("staff_seen").notNull().default(1),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** The file bytes (base64), kept apart so list queries stay light. Read only through the server. */
export const billing_file_blobs = pgTable("billing_file_blobs", {
  id: serial("id").primaryKey(),
  file_id: integer("file_id").notNull(),
  data: text("data").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** A client's request to modify or add to an uploaded quote. */
export const billing_requests = pgTable("billing_requests", {
  id: serial("id").primaryKey(),
  file_id: integer("file_id").notNull(),
  client_id: integer("client_id").notNull(),
  number: text("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** open = waiting for FRX, answered = FRX attached an annex. */
  status: text("status").notNull().default("open"),
  requested_by: integer("requested_by"),
  requested_at: text("requested_at"),
  staff_seen: integer("staff_seen").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/**
 * PRIVATE to FRX staff: what a project really costs. Either a supplier invoice (optionally with its PDF, read by the AI)
 * or a quick amount typed in. Amounts are before taxes.
 */
export const project_costs = pgTable("project_costs", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  /** "invoice" = a supplier invoice, "quick" = a single amount typed in. */
  source: text("source").notNull().default("quick"),
  supplier: text("supplier"),
  description: text("description"),
  incurred_on: text("incurred_on"),
  amount: real("amount").notNull().default(0),
  /** 1 once FRX has paid the supplier. */
  paid: integer("paid").notNull().default(0),
  /** The supplier invoice PDF (a private billing_files row of kind "supplier"). */
  file_id: integer("file_id"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** PRIVATE to FRX staff (clients can never read it): the target margin of a project. */
export const project_finance = pgTable("project_finance", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  /** Margin FRX aims for on this project, in percent of the contract before taxes. */
  target_margin_pct: real("target_margin_pct"),
  /** Quick single amount: what FRX expects the whole project to cost (before taxes). */
  planned_cost: real("planned_cost"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const app_settings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull(),
  user_id: integer("user_id").notNull(),
  expires_at: text("expires_at").notNull(),
  view_as: text("view_as").notNull().default("admin"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const time_punches = pgTable("time_punches", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  project_id: integer("project_id").notNull(),
  kind: text("kind").notNull(),
  punched_at: text("punched_at").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  accuracy: real("accuracy"),
  distance_m: integer("distance_m"),
  status: text("status").notNull(),
  note: text("note"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** Employee expenses. Staff see and edit only their own while submitted; an administrator approves and reimburses. */
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  project_id: integer("project_id"),
  expense_date: text("expense_date").notNull(),
  category: text("category").notNull(),
  vendor: text("vendor"),
  description: text("description"),
  amount: real("amount").notNull(),
  status: text("status").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** A note on a task. */
export const task_notes = pgTable("task_notes", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  task_id: integer("task_id").notNull(),
  user_id: integer("user_id"),
  body: text("body").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const task_checklist = pgTable("task_checklist", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  task_id: integer("task_id").notNull(),
  label: text("label").notNull(),
  done: integer("done").notNull().default(0),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** Project notes (a site journal). visibility: "internal" = FRX staff only, "everyone" = shown to the client too. */
export const project_notes = pgTable("project_notes", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  user_id: integer("user_id"),
  body: text("body").notNull(),
  visibility: text("visibility").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** QRT: a question and its answer. origin: "staff" or "client". */
export const project_qrt = pgTable("project_qrt", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  origin: text("origin").notNull(),
  status: text("status").notNull(),
  asked_by: integer("asked_by"),
  answered_by: integer("answered_by"),
  answered_at: timestamp("answered_at"),
  prefilled: integer("prefilled").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Files and photos attached to a task, note, safety incident or QRT entry.
 * owner_type: "task" | "note" | "sst" | "qrt". The bytes live in `data` (base64); lists never select it.
 */
export const project_attachments = pgTable("project_attachments", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull(),
  owner_type: text("owner_type").notNull(),
  owner_id: integer("owner_id").notNull(),
  file_name: text("file_name").notNull(),
  file_type: text("file_type"),
  file_size: integer("file_size").notNull(),
  data: text("data").notNull(),
  uploaded_by: integer("uploaded_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});
