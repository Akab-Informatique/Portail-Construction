import { jsPDF } from "jspdf";
import { downloadBlob } from "./download";
import { durationLabel, periodLabel, shortDate, type BreakdownRow } from "./schedule-tree";

export type SchedulePdfLabels = {
  title: string;
  noteTitle: string;
  steps: string;
  duration: string;
  period: string;
  start: string;
  end: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  responsible: string;
  progress: string;
  notes: string;
  exportedOn: string;
  page: string;
  of: string;
};

const ORANGE: [number, number, number] = [237, 125, 30];
const PHASE: [number, number, number] = [252, 228, 189];
const BREAK: [number, number, number] = [217, 217, 217];
const HEADER: [number, number, number] = [118, 118, 118];
const GRID: [number, number, number] = [196, 196, 196];
const INK: [number, number, number] = [30, 30, 28];

async function logoImage(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch("/brand/frx-logo-color.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      // The logo file is large; a 420 px copy is plenty on paper and keeps the PDF small.
      const scale = Math.min(1, 420 / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * The breakdown as a landscape sheet, like the preliminary schedule it replaces: title and FRX logo on top, a note,
 * then the table (grey header, the project's name in orange, phases shaded, tasks indented and numbered) with the
 * export date and page numbers at the foot of every page.
 */
export async function exportSchedulePdf(input: {
  projectName: string;
  yearRange: string;
  rows: BreakdownRow[];
  fr: boolean;
  note: string;
  labels: SchedulePdfLabels;
  statusOf: (row: BreakdownRow) => string;
  responsibleOf: (row: BreakdownRow) => string;
  locale: string;
}) {
  const { rows, labels, fr } = input;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 28;
  const innerW = W - M * 2;

  // columns: # | steps | duration | period | start | end | wk start | wk end | status | responsible | % | notes
  const fixed = [16, 0, 48, 58, 48, 48, 36, 36, 66, 60, 46, 0];
  const flexTotal = innerW - fixed.reduce((a, b) => a + b, 0);
  const widths = fixed.map((w, i) => (i === 1 ? flexTotal * 0.62 : i === 11 ? flexTotal * 0.38 : w));
  const xs = widths.reduce<number[]>((acc, _w, i) => [...acc, i === 0 ? M : acc[i - 1] + widths[i - 1]], []);

  // ---- header block ----
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(21);
  pdf.setTextColor(...INK);
  pdf.text(`${labels.title} ${input.projectName}  |  ${input.yearRange}`, M, 50);

  const logo = await logoImage();
  if (logo) {
    const lw = 118;
    pdf.addImage(logo.data, "PNG", W - M - lw, 24, lw, (lw * logo.h) / logo.w, undefined, "FAST");
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.text(labels.noteTitle, M, 78);
  const noteLines = pdf.splitTextToSize(input.note, innerW - 150) as string[];
  pdf.text(noteLines, M, 90);
  let y = 90 + noteLines.length * 11 + 12;

  const FONT = 6.8;
  const LINE = 8;

  const drawHeader = (top: number) => {
    const labelsRow = ["", labels.steps, labels.duration, labels.period, labels.start, labels.end, labels.weekStart, labels.weekEnd, labels.status, labels.responsible, labels.progress, labels.notes];
    pdf.setFillColor(...HEADER);
    pdf.rect(M, top, innerW, 22, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.4);
    pdf.setTextColor(255, 255, 255);
    labelsRow.forEach((text, i) => pdf.text(pdf.splitTextToSize(text, widths[i] - 5) as string[], xs[i] + 3, top + 9));
    return top + 22;
  };

  const rule = (top: number, h: number) => {
    pdf.setDrawColor(...GRID);
    pdf.setLineWidth(0.3);
    pdf.line(M, top + h, M + innerW, top + h);
    xs.forEach((x) => pdf.line(x, top, x, top + h));
    pdf.line(M + innerW, top, M + innerW, top + h);
  };

  y = drawHeader(y);

  // row 1: the project's name, in orange
  const titleH = 26;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6);
  pdf.setTextColor(120, 120, 120);
  pdf.text("1", xs[0] + 3, y + 16);
  pdf.setFontSize(15);
  pdf.setTextColor(...ORANGE);
  pdf.text(input.projectName, xs[1] + 4, y + 18);
  rule(y, titleH);
  y += titleH;

  for (const row of rows) {
    const isPhase = row.kind === "phase";
    const isBreak = row.kind === "break";
    const indent = row.depth === 1 ? 12 : 0;
    pdf.setFont("helvetica", isPhase || isBreak ? "bold" : "normal");
    pdf.setFontSize(FONT);
    const nameLines = pdf.splitTextToSize(row.task.title, widths[1] - indent - 8) as string[];
    const noteText = row.task.description ?? "";
    const notesLines = noteText ? (pdf.splitTextToSize(noteText, widths[11] - 6) as string[]) : [];
    const lines = Math.max(nameLines.length, notesLines.length, 1);
    const h = Math.max(11.5, lines * LINE + 3.5);

    if (y + h > H - 38) {
      pdf.addPage();
      y = drawHeader(28);
    }

    if (isPhase) {
      pdf.setFillColor(...PHASE);
      pdf.rect(M, y, innerW, h, "F");
    } else if (isBreak) {
      pdf.setFillColor(...BREAK);
      pdf.rect(M, y, innerW, h, "F");
    }
    pdf.setTextColor(120, 120, 120);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.text(String(row.n), xs[0] + 3, y + 8);

    pdf.setTextColor(...INK);
    pdf.setFont("helvetica", isPhase || isBreak ? "bold" : "normal");
    pdf.setFontSize(FONT);
    pdf.text(nameLines, xs[1] + 4 + indent, y + 8);

    const showStats = isPhase || row.start || row.end;
    const cells: [number, string, "left" | "right"][] = [
      [2, durationLabel(row, fr), "left"],
      [3, periodLabel(row, fr), "left"],
      [4, shortDate(row.start), "left"],
      [5, shortDate(row.end), "left"],
      [6, row.weekStart !== null ? String(row.weekStart) : "", "left"],
      [7, row.weekEnd !== null ? String(row.weekEnd) : "", "left"],
    ];
    if (showStats && !isBreak) {
      cells.push([8, input.statusOf(row), "left"], [9, input.responsibleOf(row), "left"], [10, `${row.progress}%`, "right"]);
    }
    for (const [col, text, align] of cells) {
      if (!text) continue;
      if (align === "right") pdf.text(text, xs[col] + widths[col] - 4, y + 8, { align: "right" });
      else pdf.text(text, xs[col] + 3, y + 8, { maxWidth: widths[col] - 5 });
    }
    pdf.setFont("helvetica", "normal");
    if (notesLines.length) pdf.text(notesLines, xs[11] + 3, y + 8);

    rule(y, h);
    y += h;
  }

  // ---- footers ----
  const pages = pdf.getNumberOfPages();
  const exported = new Intl.DateTimeFormat(input.locale, { dateStyle: "long", timeStyle: "short" }).format(new Date());
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(90, 90, 90);
    pdf.text(`${labels.exportedOn} ${exported}`, M, H - 18);
    pdf.text(`${labels.page} ${i} ${labels.of} ${pages}`, W - M, H - 18, { align: "right" });
  }

  const day = new Date().toISOString().slice(0, 10);
  downloadBlob(pdf.output("blob"), `${labels.title}_${input.projectName}_V${day}.pdf`.replace(/[\\/:*?"<>|]+/g, " "));
}
