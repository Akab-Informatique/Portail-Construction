#!/usr/bin/env bash
# Wipe all business data in production Postgres and leave only the default admin.
# Does NOT delete the Postgres volume. Run from /opt/frx-portal after update.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

echo "This will DELETE all clients, projects, punches, billing, and users except a new default admin."
echo "Type RESET to continue:"
read -r confirm
if [[ "$confirm" != "RESET" ]]; then
  echo "Aborted."
  exit 1
fi

docker compose exec -T db psql -U "${POSTGRES_USER:-frx}" -d "${POSTGRES_DB:-frx}" <<'SQL'
BEGIN;
TRUNCATE TABLE
  time_punches,
  sessions,
  activities,
  project_reports,
  safety_incidents,
  punch_items,
  daily_logs,
  change_orders,
  rfis,
  sharepoint_shares,
  sharepoint_folders,
  documents,
  calendar_events,
  budget_items,
  project_tasks,
  project_members,
  billing_documents,
  user_permissions,
  user_access_groups,
  user_clients,
  access_group_clients,
  access_group_permissions,
  access_groups,
  client_users,
  projects,
  clients,
  users
RESTART IDENTITY CASCADE;

INSERT INTO users (name, email, password, user_type, title, phone, is_active, is_admin, avatar_initials, locale, theme, all_clients, must_change_password, tutorial_done)
VALUES (
  'Administrator',
  'admin@frxconstruction.ca',
  'admin123',
  'internal',
  'Administrator',
  NULL,
  1,
  1,
  'AD',
  'en',
  'light',
  1,
  1,
  0
);
COMMIT;
SQL

echo
echo "Data reset. Sign in with admin@frxconstruction.ca / admin123"
echo "Create your real admin under Setup, then delete this default account."
echo "Change the default password immediately."
