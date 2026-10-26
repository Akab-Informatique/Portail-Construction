import type { Locale } from "./types";

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function localeTag(locale?: Locale) {
  return locale === "fr" ? "fr-CA" : "en-CA";
}

export function money(value: number, locale?: Locale) {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function moneyExact(value: number, locale?: Locale) {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
  }).format(value);
}

/** A "YYYY-MM-DD" day is a calendar date, not a moment: read it in local time so it never slips to the day before. */
function parseDay(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

export function formatDate(value: string | Date | null | undefined, locale?: Locale) {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDay(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, locale?: Locale) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "—";
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatMonth(date: Date, locale?: Locale) {
  return date.toLocaleString(localeTag(locale), { month: "long", year: "numeric" });
}

export function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function labelize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Today in the user's own time zone (not UTC, which flips to tomorrow in the evening). */
function localISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayISO() {
  return localISO(new Date());
}

export function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localISO(d);
}
