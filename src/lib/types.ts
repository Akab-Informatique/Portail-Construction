export type UserType = "internal" | "external";
export type Locale = "en" | "fr";
export type ThemePref = "light" | "dark";

export type User = {
  id: number;
  name: string;
  email: string;
  password: string;
  user_type: UserType;
  title: string | null;
  phone: string | null;
  is_active: number;
  is_admin: number;
  avatar_initials: string | null;
  locale: Locale;
  theme: ThemePref;
  all_clients: number;
  must_change_password: number;
  tutorial_done: number;
  created_at: Date;
};

export type ViewAsMode = "admin" | "staff" | "client";

export type SessionUser = Omit<User, "password"> & {
  view_as?: ViewAsMode;
};

export type Client = {
  id: number;
  name: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  status: string;
  created_at: Date;
};

export type Project = {
  id: number;
  client_id: number;
  name: string;
  project_number: string;
  description: string | null;
  status: string;
  phase: string;
  project_type: string | null;
  address: string | null;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: number;
  spent: number;
  sort_order: number;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_radius_m: number | null;
  require_geofence: number;
  created_at: Date;
};

export type TimePunch = {
  id: number;
  user_id: number;
  project_id: number;
  kind: "in" | "out";
  punched_at: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distance_m: number | null;
  status: string;
  note: string | null;
  created_at: Date;
};

export type BoardColumn = {
  id: number;
  slug: string;
  label: string;
  sort_order: number;
  is_system: number;
  color: string;
  created_at: Date;
};

export type Permission = {
  id: number;
  user_id: number;
  module: string;
  scope_type: string;
  scope_id: number;
  can_view: number;
  can_create: number;
  can_edit: number;
  can_delete: number;
};

export type AccessGroupAudience = "internal" | "external" | "both";

export type AccessGroup = {
  id: number;
  name: string;
  description: string | null;
  audience: AccessGroupAudience;
  all_clients: number;
  created_at: Date;
};

export type AccessGroupPermission = {
  id: number;
  group_id: number;
  module: string;
  can_view: number;
  can_create: number;
  can_edit: number;
  can_delete: number;
};

export type AccessGroupClient = {
  id: number;
  group_id: number;
  client_id: number;
};

export type UserAccessGroup = {
  id: number;
  user_id: number;
  group_id: number;
};

export type UserClient = {
  id: number;
  user_id: number;
  client_id: number;
};

export type BillingKind = "invoice" | "quote";

export type InvoiceLine = {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
};

export type BillingDocument = {
  id: number;
  client_id: number;
  project_id: number | null;
  kind: BillingKind;
  number: string;
  title: string;
  description: string | null;
  amount: number;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  notes: string | null;
  source_quote_id: number | null;
  line_items: string | null;
  subtotal: number | null;
  tax_gst: number | null;
  tax_qst: number | null;
  po_number: string | null;
  sent_at: string | null;
  sent_to: string | null;
  signed_by: string | null;
  signed_at: string | null;
  signature: string | null;
  created_at: Date;
};

export type CompanyProfile = {
  legal_name: string;
  address: string;
  city: string;
  province: string;
  postal: string;
  phone: string;
  email: string;
  gst: string;
  qst: string;
};

export type SmtpSettings = {
  host: string;
  port: string;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
  secure: boolean;
  /** Public address of the portal, used to build links in emails (e.g. password reset). */
  portal_url?: string;
};

export type EmailTemplateKey = "send_invoice" | "send_quote" | "follow_up" | "password_reset";

export type EmailTemplate = {
  key: EmailTemplateKey;
  subject: string;
  body: string;
};

export type EmailTemplates = Record<EmailTemplateKey, EmailTemplate>;

export type QuickBooksSettings = {
  client_id: string;
  client_secret: string;
  realm_id: string;
  environment: "sandbox" | "production";
  connected: boolean;
  last_sync: string | null;
};

export type SharePointSettings = {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  site_url: string;
  drive_id: string;
  library_name: string;
  connected: boolean;
};

export type SharePointFolder = {
  id: number;
  project_id: number;
  name: string;
  sp_item_id: string;
  sp_drive_id: string;
  path: string;
  created_at: Date;
};

export type SharePointShare = {
  id: number;
  folder_id: number;
  client_id: number;
  item_id: string;
  can_view: number;
  can_upload: number;
  can_edit: number;
  created_at: Date;
};

export type Action = "view" | "create" | "edit" | "delete";

export type ModuleId =
  | "dashboard"
  | "calendar"
  | "budget"
  | "tasks"
  | "documents"
  | "rfis"
  | "change_orders"
  | "daily_logs"
  | "punch"
  | "safety"
  | "team"
  | "reports"
  | "clients"
  | "users"
  | "billing";
