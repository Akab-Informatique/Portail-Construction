import type { LucideIcon } from "lucide-react";
import {
  FolderTree,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  ReceiptText,
  ShieldAlert,
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
  { id: "dashboard", labelKey: "pnav.overview", icon: LayoutDashboard },
  { id: "documents", labelKey: "pnav.documents", icon: FolderTree },
  { id: "tasks", labelKey: "pnav.schedule", icon: ListChecks },
  { id: "notes", labelKey: "pnav.notes", icon: NotebookPen },
  { id: "safety", labelKey: "pnav.sst", icon: ShieldAlert },
  { id: "qrt", labelKey: "pnav.qrt", icon: MessagesSquare },
  { id: "project_billing", labelKey: "pnav.billing", icon: ReceiptText },
];

export const PROJECT_NAV_GROUPS: ProjectNavGroup[] = [
  { id: "overview", labelKey: "project.group.overview", items: PROJECT_NAV.filter((n) => n.id === "dashboard" || n.id === "documents") },
  { id: "plan", labelKey: "project.group.plan", items: PROJECT_NAV.filter((n) => n.id === "tasks" || n.id === "notes" || n.id === "safety" || n.id === "qrt") },
  { id: "controls", labelKey: "project.group.controls", items: PROJECT_NAV.filter((n) => n.id === "project_billing") },
];

const MODULE_IDS = new Set<string>(PROJECT_NAV.map((n) => n.id));

export function isProjectSection(value: string | undefined): value is ModuleId {
  return !!value && MODULE_IDS.has(value);
}

export function projectSectionPath(projectId: number, section: ModuleId) {
  return section === "dashboard" ? `/projects/${projectId}` : `/projects/${projectId}/${section}`;
}
