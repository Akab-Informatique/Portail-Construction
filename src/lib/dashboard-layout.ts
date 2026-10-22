import { DASHBOARD_LAYOUT_KEY } from "./constants";

export const DASHBOARD_WIDGETS = ["calendar", "gantt", "projects"] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number];

export type DashboardWidget = {
  id: DashboardWidgetId;
  visible: boolean;
};

export const DEFAULT_DASHBOARD: DashboardWidget[] = [
  { id: "calendar", visible: true },
  { id: "gantt", visible: true },
  { id: "projects", visible: true },
];

function storageKey(userId?: number) {
  return userId ? `${DASHBOARD_LAYOUT_KEY}_${userId}` : DASHBOARD_LAYOUT_KEY;
}

export function loadDashboardLayout(userId?: number): DashboardWidget[] {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_DASHBOARD;
    const parsed = JSON.parse(raw) as DashboardWidget[];
    if (!Array.isArray(parsed)) return DEFAULT_DASHBOARD;
    const seen = new Set<string>();
    const next: DashboardWidget[] = [];
    for (const item of parsed) {
      if (!DASHBOARD_WIDGETS.includes(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      next.push({ id: item.id, visible: Boolean(item.visible) });
    }
    for (const id of DASHBOARD_WIDGETS) {
      if (!seen.has(id)) next.push({ id, visible: id !== "gantt" ? true : true });
    }
    return next;
  } catch {
    return DEFAULT_DASHBOARD;
  }
}

export function saveDashboardLayout(layout: DashboardWidget[], userId?: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(userId), JSON.stringify(layout));
}
