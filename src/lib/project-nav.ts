import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  FileWarning,
  HardHat,
  LayoutDashboard,
  ListChecks,
  Presentation,
  ShieldAlert,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import type { MessageKey } from "./i18n/en";
import type { ModuleId } from "./types";

export type ProjectNavItem = {
  id: ModuleId;
  labelKey: MessageKey;
  icon: LucideIcon;
};

export type ProjectNavGroup = {
  id: "overview" | "plan" | "field" | "controls";
  labelKey: MessageKey;
  items: ProjectNavItem[];
};

export const PROJECT_NAV: ProjectNavItem[] = [
  { id: "dashboard", labelKey: "project.nav.dashboard", icon: LayoutDashboard },
  { id: "calendar", labelKey: "project.nav.calendar", icon: CalendarDays },
  { id: "tasks", labelKey: "project.nav.schedule", icon: ListChecks },
  { id: "documents", labelKey: "project.nav.documents", icon: FileText },
  { id: "daily_logs", labelKey: "project.nav.dailyLogs", icon: HardHat },
  { id: "punch", labelKey: "project.nav.punch", icon: TriangleAlert },
  { id: "safety", labelKey: "project.nav.safety", icon: ShieldAlert },
  { id: "rfis", labelKey: "project.nav.rfis", icon: FileWarning },
  { id: "change_orders", labelKey: "project.nav.changes", icon: ClipboardList },
  { id: "budget", labelKey: "project.nav.budget", icon: Wallet },
  { id: "team", labelKey: "project.nav.team", icon: Users },
  { id: "reports", labelKey: "project.nav.reports", icon: Presentation },
];

export const PROJECT_NAV_GROUPS: ProjectNavGroup[] = [
  {
    id: "overview",
    labelKey: "project.group.overview",
    items: PROJECT_NAV.filter((n) => n.id === "dashboard" || n.id === "documents"),
  },
  {
    id: "plan",
    labelKey: "project.group.plan",
    items: PROJECT_NAV.filter((n) => n.id === "calendar" || n.id === "tasks"),
  },
  {
    id: "field",
    labelKey: "project.group.field",
    items: PROJECT_NAV.filter((n) => n.id === "daily_logs" || n.id === "punch" || n.id === "safety"),
  },
  {
    id: "controls",
    labelKey: "project.group.controls",
    items: PROJECT_NAV.filter((n) => n.id === "rfis" || n.id === "change_orders" || n.id === "budget" || n.id === "team" || n.id === "reports"),
  },
];

const MODULE_IDS = new Set<string>(PROJECT_NAV.map((n) => n.id));

export function isProjectSection(value: string | undefined): value is ModuleId {
  return !!value && MODULE_IDS.has(value);
}

export function projectSectionPath(projectId: number, section: ModuleId) {
  return section === "dashboard" ? `/projects/${projectId}` : `/projects/${projectId}/${section}`;
}
