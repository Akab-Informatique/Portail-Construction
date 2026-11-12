const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * Calendar days from the start to the end, both days counted: a task that starts and ends the same day lasts 1 day.
 * Null when a date is missing or the end comes before the start.
 */
export function dayCount(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = utc(start);
  const b = utc(end);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / DAY) + 1;
}

/** The end date of a task that starts on `start` and lasts `days` calendar days (the start day counts). */
export function endAfter(start: string, days: number): string {
  return new Date(utc(start) + (days - 1) * DAY).toISOString().slice(0, 10);
}

/** A whole number of days typed in a field, or null when it is not one (blank, 0, 2.5...). */
export function wholeDays(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}
