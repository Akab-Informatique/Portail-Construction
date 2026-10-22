import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { Project } from "./types";

/** Distinct, readable on light and dark. Each running project owns one until it is completed. */
export const PROJECT_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#eab308",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
  "#d946ef",
  "#0ea5e9",
  "#f43f5e",
  "#a16207",
  "#64748b",
];

export const FALLBACK_PROJECT_COLOR = "#fbaa19";

/** A project holds on to its color while it is not completed. */
export function holdsColor(p: Pick<Project, "status">) {
  return p.status !== "completed";
}

/** First palette color nobody running is using; beyond the palette, a new hue is generated. */
export function pickFreeColor(taken: Iterable<string | null | undefined>): string {
  const used = new Set([...taken].filter(Boolean).map((c) => String(c).toLowerCase()));
  const free = PROJECT_COLORS.find((c) => !used.has(c));
  if (free) return free;
  for (let i = 0; i < 360; i++) {
    const hue = (i * 137.508) % 360;
    const hex = hslToHex(hue, 70, 52);
    if (!used.has(hex)) return hex;
  }
  return FALLBACK_PROJECT_COLOR;
}

function hslToHex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Color for a project about to be created: never one used by a running project. */
export async function nextProjectColor(): Promise<string> {
  const rows = (await db.select({ color: schema.projects.color, status: schema.projects.status }).from(schema.projects)) as {
    color: string | null;
    status: string;
  }[];
  return pickFreeColor(rows.filter(holdsColor).map((r) => r.color));
}

/**
 * Gives a color to projects that have none (older data) and fixes two running projects sharing one.
 * Returns the projects with their colors filled in, saving the changes.
 */
export async function ensureProjectColors<T extends Pick<Project, "id" | "status"> & { color?: string | null }>(projects: T[]): Promise<T[]> {
  const taken = new Map<string, number>();
  const next = new Map<number, string>();
  const ordered = [...projects].sort((a, b) => a.id - b.id);
  for (const p of ordered) {
    const color = p.color?.toLowerCase();
    if (!holdsColor(p)) continue;
    if (color && !taken.has(color)) taken.set(color, p.id);
  }
  for (const p of ordered) {
    const color = p.color?.toLowerCase();
    if (holdsColor(p)) {
      if (color && taken.get(color) === p.id) continue;
      const fresh = pickFreeColor(taken.keys());
      taken.set(fresh, p.id);
      next.set(p.id, fresh);
    } else if (!color) {
      next.set(p.id, FALLBACK_PROJECT_COLOR);
    }
  }
  if (next.size === 0) return projects;
  await Promise.all([...next].map(([id, color]) => db.update(schema.projects).set({ color }).where(eq(schema.projects.id, id))));
  return projects.map((p) => (next.has(p.id) ? { ...p, color: next.get(p.id)! } : p));
}

export function projectColor(p: { color?: string | null }) {
  return p.color || FALLBACK_PROJECT_COLOR;
}
