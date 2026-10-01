/** Shared DDL applied to PGlite (dev) and Postgres (production). */
export const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, user_type TEXT NOT NULL, title TEXT, phone TEXT, is_active INTEGER NOT NULL, is_admin INTEGER NOT NULL, avatar_initials TEXT, locale TEXT NOT NULL DEFAULT 'en', theme TEXT NOT NULL DEFAULT 'light', all_clients INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS all_clients INTEGER;
UPDATE users SET locale = 'en' WHERE locale IS NULL;
UPDATE users SET theme = 'light' WHERE theme IS NULL;
UPDATE users SET all_clients = 1 WHERE all_clients IS NULL AND user_type = 'internal';
UPDATE users SET all_clients = 0 WHERE all_clients IS NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_done INTEGER;
UPDATE users SET must_change_password = 0 WHERE must_change_password IS NULL;
UPDATE users SET tutorial_done = 1 WHERE tutorial_done IS NULL;
CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, name TEXT NOT NULL, company_name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, city TEXT, state TEXT, zip TEXT, notes TEXT, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS client_users (id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL, user_id INTEGER NOT NULL, is_primary INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL, name TEXT NOT NULL, project_number TEXT NOT NULL, description TEXT, status TEXT NOT NULL, phase TEXT NOT NULL, project_type TEXT, address TEXT, city TEXT, start_date TEXT, end_date TEXT, budget REAL NOT NULL, spent REAL NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER;
UPDATE projects SET sort_order = id WHERE sort_order IS NULL;
CREATE TABLE IF NOT EXISTS board_columns (id SERIAL PRIMARY KEY, slug TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL, is_system INTEGER NOT NULL, color TEXT NOT NULL DEFAULT 'slate', created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE board_columns ADD COLUMN IF NOT EXISTS color TEXT;
UPDATE board_columns SET color = 'sky' WHERE slug = 'planning' AND (color IS NULL OR color = '');
UPDATE board_columns SET color = 'emerald' WHERE slug = 'active' AND (color IS NULL OR color = '');
UPDATE board_columns SET color = 'amber' WHERE slug = 'on_hold' AND (color IS NULL OR color = '');
UPDATE board_columns SET color = 'slate' WHERE slug = 'completed' AND (color IS NULL OR color = '');
UPDATE board_columns SET color = 'slate' WHERE color IS NULL OR color = '';
INSERT INTO board_columns (slug, label, sort_order, is_system)
  SELECT 'planning', 'Planning', 0, 1
  WHERE NOT EXISTS (SELECT 1 FROM board_columns LIMIT 1);
INSERT INTO board_columns (slug, label, sort_order, is_system)
  SELECT 'active', 'Active', 1, 1
  WHERE NOT EXISTS (SELECT 1 FROM board_columns WHERE slug = 'active')
    AND EXISTS (SELECT 1 FROM board_columns WHERE slug = 'planning');
INSERT INTO board_columns (slug, label, sort_order, is_system)
  SELECT 'on_hold', 'On hold', 2, 1
  WHERE NOT EXISTS (SELECT 1 FROM board_columns WHERE slug = 'on_hold')
    AND EXISTS (SELECT 1 FROM board_columns WHERE slug = 'planning');
INSERT INTO board_columns (slug, label, sort_order, is_system)
  SELECT 'completed', 'Completed', 3, 1
  WHERE NOT EXISTS (SELECT 1 FROM board_columns WHERE slug = 'completed')
    AND EXISTS (SELECT 1 FROM board_columns WHERE slug = 'planning');
CREATE TABLE IF NOT EXISTS project_members (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS user_permissions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, module TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id INTEGER NOT NULL, can_view INTEGER NOT NULL, can_create INTEGER NOT NULL, can_edit INTEGER NOT NULL, can_delete INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS project_tasks (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, start_date TEXT, end_date TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, assigned_to INTEGER, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS budget_items (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, estimated REAL NOT NULL, actual REAL NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_events (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, event_date TEXT NOT NULL, end_date TEXT, event_type TEXT NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, notes TEXT, uploaded_by INTEGER, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS rfis (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, number TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, assigned_to INTEGER, due_date TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS change_orders (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, number TEXT NOT NULL, title TEXT NOT NULL, description TEXT, amount REAL NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS daily_logs (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, log_date TEXT NOT NULL, weather TEXT, crew_count INTEGER NOT NULL, notes TEXT, created_by INTEGER, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS punch_items (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, location TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, assigned_to INTEGER, due_date TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS safety_incidents (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, incident_date TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS activities (id SERIAL PRIMARY KEY, project_id INTEGER, client_id INTEGER, user_id INTEGER, action TEXT NOT NULL, details TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS access_groups (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, audience TEXT NOT NULL, all_clients INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS access_group_permissions (id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL, module TEXT NOT NULL, can_view INTEGER NOT NULL, can_create INTEGER NOT NULL, can_edit INTEGER NOT NULL, can_delete INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS access_group_clients (id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL, client_id INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS user_access_groups (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS user_clients (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, client_id INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS billing_documents (id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL, project_id INTEGER, kind TEXT NOT NULL, number TEXT NOT NULL, title TEXT NOT NULL, description TEXT, amount REAL NOT NULL, status TEXT NOT NULL, issued_on TEXT, due_on TEXT, notes TEXT, source_quote_id INTEGER, line_items TEXT, subtotal REAL, tax_gst REAL, tax_qst REAL, po_number TEXT, sent_at TEXT, sent_to TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS source_quote_id INTEGER;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS line_items TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS subtotal REAL;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS tax_gst REAL;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS tax_qst REAL;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS sent_at TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS sent_to TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS signed_by TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS signed_at TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS signature TEXT;
CREATE TABLE IF NOT EXISTS app_settings (id SERIAL PRIMARY KEY, key TEXT NOT NULL, value TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geo_lat REAL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geo_lng REAL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geo_radius_m INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_geofence INTEGER;
UPDATE projects SET require_geofence = 0 WHERE require_geofence IS NULL;
CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, token TEXT NOT NULL, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, view_as TEXT NOT NULL DEFAULT 'admin', created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS view_as TEXT;
UPDATE sessions SET view_as = 'admin' WHERE view_as IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token);
CREATE TABLE IF NOT EXISTS time_punches (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, project_id INTEGER NOT NULL, kind TEXT NOT NULL, punched_at TEXT NOT NULL, lat REAL, lng REAL, accuracy REAL, distance_m INTEGER, status TEXT NOT NULL, note TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS project_reports (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, sections TEXT NOT NULL, created_by INTEGER, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS sharepoint_folders (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, sp_item_id TEXT NOT NULL, sp_drive_id TEXT NOT NULL, path TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS sharepoint_shares (id SERIAL PRIMARY KEY, folder_id INTEGER NOT NULL, client_id INTEGER NOT NULL, item_id TEXT NOT NULL DEFAULT '', can_view INTEGER NOT NULL, can_upload INTEGER NOT NULL, can_edit INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
ALTER TABLE sharepoint_shares ADD COLUMN IF NOT EXISTS item_id TEXT;
UPDATE sharepoint_shares SET item_id = '' WHERE item_id IS NULL;
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS app_settings_key_idx ON app_settings (key);
CREATE INDEX IF NOT EXISTS client_users_user_idx ON client_users (user_id);
CREATE INDEX IF NOT EXISTS client_users_client_idx ON client_users (client_id);
CREATE INDEX IF NOT EXISTS user_clients_user_idx ON user_clients (user_id);
CREATE INDEX IF NOT EXISTS user_permissions_user_idx ON user_permissions (user_id);
CREATE INDEX IF NOT EXISTS user_access_groups_user_idx ON user_access_groups (user_id);
CREATE INDEX IF NOT EXISTS access_group_permissions_group_idx ON access_group_permissions (group_id);
CREATE INDEX IF NOT EXISTS access_group_clients_group_idx ON access_group_clients (group_id);
CREATE INDEX IF NOT EXISTS projects_client_idx ON projects (client_id);
CREATE INDEX IF NOT EXISTS billing_documents_client_idx ON billing_documents (client_id);
CREATE INDEX IF NOT EXISTS time_punches_user_time_idx ON time_punches (user_id, punched_at DESC);
CREATE INDEX IF NOT EXISTS time_punches_project_idx ON time_punches (project_id);
CREATE INDEX IF NOT EXISTS activities_project_idx ON activities (project_id);
CREATE INDEX IF NOT EXISTS activities_client_idx ON activities (client_id);
CREATE INDEX IF NOT EXISTS sharepoint_shares_client_idx ON sharepoint_shares (client_id);
CREATE INDEX IF NOT EXISTS sharepoint_folders_project_idx ON sharepoint_folders (project_id);
CREATE INDEX IF NOT EXISTS project_members_project_idx ON project_members (project_id);
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON project_tasks (project_id);
CREATE INDEX IF NOT EXISTS budget_items_project_idx ON budget_items (project_id);
CREATE INDEX IF NOT EXISTS calendar_events_project_idx ON calendar_events (project_id);
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (project_id);
CREATE INDEX IF NOT EXISTS rfis_project_idx ON rfis (project_id);
CREATE INDEX IF NOT EXISTS change_orders_project_idx ON change_orders (project_id);
CREATE INDEX IF NOT EXISTS daily_logs_project_idx ON daily_logs (project_id);
CREATE INDEX IF NOT EXISTS punch_items_project_idx ON punch_items (project_id);
CREATE INDEX IF NOT EXISTS safety_incidents_project_idx ON safety_incidents (project_id);
CREATE INDEX IF NOT EXISTS project_reports_project_idx ON project_reports (project_id);
`;
