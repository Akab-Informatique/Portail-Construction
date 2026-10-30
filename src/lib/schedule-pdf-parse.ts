/**
 * Reads a construction schedule exported as a PDF table: one column per line of the schedule (the project, its phases and
 * their tasks), with rows for the start and end dates, the status, who is responsible and notes, and the names written
 * along the bottom. Pure text-layout work, so it can be checked without a browser.
 */

export type PdfTextItem = { s: string; x: number; y: number };
export type PdfPage = { items: PdfTextItem[] };

export type ParsedTask = { title: string; start: string | null; end: string | null; /** dates taken from the group or phase above */ inherited: boolean; notes: string | null; responsible: string | null };
export type ParsedPhase = { title: string; kind: "phase" | "break"; start: string | null; end: string | null; notes: string | null; responsible: string | null; tasks: ParsedTask[] };
export type ParsedSchedule = { title: string | null; phases: ParsedPhase[]; warnings: string[] };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const FIELD = {
  start: /^(date )?debut$|^start( date)?$/,
  end: /^(date )?fin$|^end( date)?$/,
  notes: /^notes?$/,
  responsible: /^responsables?$|^owner$|^assigned( to)?$/,
  steps: /^etapes?$|^steps?$|^#$/,
};

/** 26-10-09, 2026-10-09, 09/10/2026 → 2026-10-09. */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const clean = (s: string) => s.replace(/[❄❅❆]/g, "").replace(/\s+/g, " ").trim();
const isBreak = (title: string) => /\b(pause|conge|cong[eé]s?|vacances|holidays?|break|shutdown)\b/i.test(title);

type Row = { page: number; x: number; level: 1 | 2; title: string; start: string | null; end: string | null; notes: string | null; responsible: string | null };

export function parseSchedule(pages: PdfPage[]): ParsedSchedule {
  const warnings: string[] = [];
  const rows: Row[] = [];
  let levelY: number | null = null;

  // 1. where each kind of value sits on each page, found from the labels at the left of the table
  type Layout = { startY: number; endY: number; notesY: number | null; respY: number | null; stepY: number | null; firstFieldY: number };
  const layouts: (Layout | null)[] = pages.map((page) => {
    const labels = page.items.filter((i) => {
      const p = plain(i.s);
      return FIELD.start.test(p) || FIELD.end.test(p) || FIELD.notes.test(p) || FIELD.responsible.test(p) || FIELD.steps.test(p);
    });
    const left = labels.length ? Math.min(...labels.map((l) => l.x)) : 0;
    const at = (re: RegExp) => labels.find((l) => re.test(plain(l.s)) && Math.abs(l.x - left) < 6)?.y ?? null;
    const startY = at(FIELD.start);
    const endY = at(FIELD.end);
    if (startY === null || endY === null) return null;
    const allLeft = page.items.filter((i) => Math.abs(i.x - left) < 6 && i.y > 0).map((i) => i.y);
    const stepY = at(FIELD.steps);
    // the labels of the lines are written below the first field of the table (e.g. below "Durée")
    const fieldYs = allLeft.filter((y) => stepY === null || y > stepY + 5);
    return { startY, endY, notesY: at(FIELD.notes), respY: at(FIELD.responsible), stepY, firstFieldY: fieldYs.length ? Math.min(...fieldYs) : startY };
  });

  pages.forEach((page, p) => {
    const lay = layouts[p];
    if (!lay) {
      if (page.items.length) warnings.push(`page ${p + 1}`);
      return;
    }
    const labels = page.items.filter((i) => i.y > (lay.stepY ?? 0) + 4 && i.y < lay.firstFieldY - 8 && clean(i.s) && !/^\d+$/.test(clean(i.s)));
    for (const l of labels) levelY = levelY === null ? l.y : Math.min(levelY, l.y);
    const near = (x: number, y: number | null, re?: RegExp) => (y === null ? undefined : page.items.find((i) => Math.abs(i.x - x) < 2.5 && Math.abs(i.y - y) < 4 && (!re || re.test(i.s))));
    for (const l of labels) {
      const start = near(l.x, lay.startY);
      const end = near(l.x, lay.endY);
      rows.push({
        page: p,
        x: l.x,
        level: 1,
        title: clean(l.s),
        start: start ? toIsoDate(start.s) : null,
        end: end ? toIsoDate(end.s) : null,
        notes: ((n) => (n ? clean(n.s) : null))(near(l.x, lay.notesY)),
        responsible: ((n) => (n ? clean(n.s) : null))(near(l.x, lay.respY)),
      });
      (rows[rows.length - 1] as Row & { y: number }).y = l.y;
    }
  });

  // 2. the line a name sits on tells its level: the first position is a phase, anything further along is a task
  for (const r of rows as (Row & { y: number })[]) r.level = levelY !== null && r.y - levelY < 3 ? 1 : 2;
  rows.sort((a, b) => a.page - b.page || a.x - b.x);

  // 3. build phases and their tasks
  let title: string | null = null;
  const phases: ParsedPhase[] = [];
  let current: ParsedPhase | null = null;
  let dated: { start: string | null; end: string | null } = { start: null, end: null };
  for (const r of rows) {
    if (r.level === 1) {
      // the first name with no dates is the project itself
      if (!r.start && !r.end && phases.length === 0 && title === null) {
        title = r.title;
        continue;
      }
      current = { title: r.title, kind: isBreak(r.title) ? "break" : "phase", start: r.start, end: r.end, notes: r.notes, responsible: r.responsible, tasks: [] };
      phases.push(current);
      dated = { start: r.start, end: r.end };
      continue;
    }
    if (!current) {
      current = { title: "—", kind: "phase", start: null, end: null, notes: null, responsible: null, tasks: [] };
      phases.push(current);
    }
    const own = Boolean(r.start && r.end);
    if (own) dated = { start: r.start, end: r.end };
    current.tasks.push({ title: r.title, start: r.start ?? dated.start, end: r.end ?? dated.end, inherited: !own, notes: r.notes, responsible: r.responsible });
  }

  // a phase with no dates of its own spans its tasks
  for (const ph of phases) {
    if (ph.start && ph.end) continue;
    const starts = ph.tasks.map((t) => t.start).filter((d): d is string => Boolean(d)).sort();
    const ends = ph.tasks.map((t) => t.end).filter((d): d is string => Boolean(d)).sort();
    ph.start = ph.start ?? starts[0] ?? null;
    ph.end = ph.end ?? ends[ends.length - 1] ?? null;
  }
  return { title, phases, warnings };
}
