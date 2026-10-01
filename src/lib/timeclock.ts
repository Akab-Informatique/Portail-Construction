import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { Project, TimePunch } from "./types";

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function projectFence(project: Project) {
  if (!project.require_geofence) return null;
  if (project.geo_lat == null || project.geo_lng == null) return null;
  return {
    lat: project.geo_lat,
    lng: project.geo_lng,
    radius: project.geo_radius_m && project.geo_radius_m > 0 ? project.geo_radius_m : 200,
  };
}

export function minutesBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function weekStartISO(value = new Date()) {
  const d = new Date(value);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export type TimeEntry = {
  punchIn: TimePunch;
  punchOut: TimePunch | null;
  minutes: number;
  open: boolean;
};

export function pairPunches(punches: TimePunch[]): TimeEntry[] {
  const sorted = [...punches].sort((a, b) => a.punched_at.localeCompare(b.punched_at));
  const entries: TimeEntry[] = [];
  let open: TimePunch | null = null;
  for (const punch of sorted) {
    if (punch.kind === "in") {
      if (open) {
        entries.push({ punchIn: open, punchOut: null, minutes: 0, open: true });
      }
      open = punch;
      continue;
    }
    if (open) {
      entries.push({
        punchIn: open,
        punchOut: punch,
        minutes: minutesBetween(open.punched_at, punch.punched_at),
        open: false,
      });
      open = null;
    }
  }
  if (open) entries.push({ punchIn: open, punchOut: null, minutes: 0, open: true });
  return entries.reverse();
}

export async function loadUserPunches(userId: number) {
  return (await db
    .select()
    .from(schema.time_punches)
    .where(eq(schema.time_punches.user_id, userId))
    .orderBy(desc(schema.time_punches.punched_at))) as TimePunch[];
}

export async function openPunchForUser(userId: number) {
  const punches = await loadUserPunches(userId);
  const last = punches[0];
  return last?.kind === "in" ? last : null;
}

export async function createPunch(input: {
  userId: number;
  projectId: number;
  kind: "in" | "out";
  punchedAt: string;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  distance?: number | null;
  status: string;
  note?: string | null;
}) {
  const [row] = await db
    .insert(schema.time_punches)
    .values({
      user_id: input.userId,
      project_id: input.projectId,
      kind: input.kind,
      punched_at: input.punchedAt,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      accuracy: input.accuracy ?? null,
      distance_m: input.distance ?? null,
      status: input.status,
      note: input.note ?? null,
    })
    .returning();
  return row as TimePunch;
}

export async function loadProjectPunches(projectId: number) {
  return (await db
    .select()
    .from(schema.time_punches)
    .where(eq(schema.time_punches.project_id, projectId))
    .orderBy(desc(schema.time_punches.punched_at))) as TimePunch[];
}

export async function loadAllPunches() {
  return (await db.select().from(schema.time_punches).orderBy(desc(schema.time_punches.punched_at))) as TimePunch[];
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation-unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 15000,
    });
  });
}

export async function lastInForUserOnProject(userId: number, projectId: number) {
  const rows = (await db
    .select()
    .from(schema.time_punches)
    .where(and(eq(schema.time_punches.user_id, userId), eq(schema.time_punches.project_id, projectId)))
    .orderBy(desc(schema.time_punches.punched_at))) as TimePunch[];
  return rows[0] ?? null;
}

export type PunchErrorCode =
  | "punch.error.denied"
  | "punch.error.unavailable"
  | "punch.error.timeout"
  | "punch.error.insecure"
  | "punch.error.outside"
  | "punch.error.noPin"
  | "punch.error.needLocation"
  | "punch.error.alreadyIn"
  | "punch.error.notIn"
  | "punch.error.noProject"
  | "punch.error.notStaff"
  | "punch.error.network"
  | "punch.error.failed";

export type PunchFailure = {
  code: PunchErrorCode;
  distance?: number;
  radius?: number;
  accuracy?: number | null;
  open?: TimePunch;
};

export type PunchResult = { ok: true; punch: TimePunch } | { ok: false; failure: PunchFailure };

/** Maps a browser geolocation failure to a reason the crew can act on. */
export function locationFailure(err: unknown): PunchFailure {
  if (typeof window !== "undefined" && !window.isSecureContext) return { code: "punch.error.insecure" };
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) return { code: "punch.error.denied" };
  if (code === 3) return { code: "punch.error.timeout" };
  if (code === 2) return { code: "punch.error.unavailable" };
  if (err instanceof Error && err.message === "geolocation-unavailable") return { code: "punch.error.unavailable" };
  return { code: "punch.error.unavailable" };
}

/** Fired after a successful punch so the header badge and pages refresh. */
export const PUNCH_CHANGED_EVENT = "frx:punch-changed";

/**
 * Records a check-in or check-out. Location is read here, only because the
 * user pressed the button, and only when the job requires it. In production
 * the server stamps the time and enforces the site rule.
 */
export async function submitPunch(input: {
  userId: number;
  project: Project;
  kind: "in" | "out";
  note?: string | null;
}): Promise<PunchResult> {
  const fence = projectFence(input.project);
  // The site rule gates checking IN. Checking OUT is never blocked (otherwise a
  // shift could keep running after the worker left); it is recorded and flagged.
  const enforce = input.kind === "in";
  if (enforce && input.project.require_geofence && !fence) return { ok: false, failure: { code: "punch.error.noPin" } };

  let lat: number | null = null;
  let lng: number | null = null;
  let accuracy: number | null = null;
  if (fence) {
    try {
      const pos = await getCurrentPosition();
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      accuracy = pos.coords.accuracy ?? null;
    } catch (err) {
      if (enforce) return { ok: false, failure: locationFailure(err) };
    }
    if (enforce && lat !== null && lng !== null) {
      const distance = haversineMeters({ lat, lng }, { lat: fence.lat, lng: fence.lng });
      if (distance > fence.radius) {
        return {
          ok: false,
          failure: { code: "punch.error.outside", distance, radius: fence.radius, accuracy: accuracy && Math.round(accuracy) },
        };
      }
    }
  }

  if (import.meta.env.PROD) {
    let res: Response;
    try {
      res = await fetch("/api/db", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "punch",
          kind: input.kind,
          project_id: input.project.id,
          lat,
          lng,
          accuracy,
          note: input.note ?? null,
        }),
      });
    } catch {
      return { ok: false, failure: { code: "punch.error.network" } };
    }
    const data = (await res.json().catch(() => ({}))) as {
      punch?: TimePunch;
      error?: string;
      distance?: number;
      radius?: number;
      accuracy?: number | null;
      open?: TimePunch;
    };
    if (data.punch) {
      window.dispatchEvent(new Event(PUNCH_CHANGED_EVENT));
      return { ok: true, punch: data.punch };
    }
    const code = (data.error?.startsWith("punch.error.") ? data.error : "punch.error.failed") as PunchErrorCode;
    return { ok: false, failure: { code, distance: data.distance, radius: data.radius, accuracy: data.accuracy, open: data.open } };
  }

  // Dev (in-browser database): same state rules, checked locally.
  const open = await openPunchForUser(input.userId);
  if (input.kind === "in" && open) return { ok: false, failure: { code: "punch.error.alreadyIn", open } };
  if (input.kind === "out" && !open) return { ok: false, failure: { code: "punch.error.notIn" } };
  const localDistance = fence && lat !== null && lng !== null ? haversineMeters({ lat, lng }, fence) : null;
  const localStatus =
    !fence ? "ok" : localDistance === null ? "no_location" : localDistance > fence.radius ? "offsite" : "ok";
  try {
    const punch = await createPunch({
      userId: input.userId,
      projectId: input.kind === "out" && open ? open.project_id : input.project.id,
      kind: input.kind,
      punchedAt: new Date().toISOString(),
      lat,
      lng,
      accuracy,
      distance: localDistance,
      status: localStatus,
      note: input.note ?? null,
    });
    window.dispatchEvent(new Event(PUNCH_CHANGED_EVENT));
    return { ok: true, punch };
  } catch {
    return { ok: false, failure: { code: "punch.error.failed" } };
  }
}

/** Live H:MM:SS for a running shift. */
export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Accepts "45.5", "45,5" or " -73.56 " and rejects anything out of range. */
export function parseCoordinate(value: string, max: number) {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && Math.abs(n) <= max && value.trim() !== "" ? n : null;
}

/** "85 m", "1.4 km", "233 km". */
export function formatDistance(meters: number, locale: "en" | "fr" = "en") {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const text = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return `${locale === "fr" ? text.replace(".", ",") : text} km`;
}
