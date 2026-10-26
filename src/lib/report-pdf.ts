import { jsPDF } from "jspdf";
import { downloadBlob } from "./download";
import { formatDate } from "./format";
import { logoImage } from "./schedule-pdf";
import type { Locale } from "./types";
import type { BuiltReport } from "./project-report";

// FRX Construction brand (from the company brochure): orange, charcoal, slate grey, white, with a fine gold diagonal.
const ORANGE: [number, number, number] = [250, 163, 43];
const CHARCOAL: [number, number, number] = [32, 29, 30];
const SLATE: [number, number, number] = [80, 85, 77];
const WHITE: [number, number, number] = [255, 255, 255];
const PAPER: [number, number, number] = [250, 249, 246];
const ZEBRA: [number, number, number] = [238, 238, 234];
const MUTED: [number, number, number] = [110, 114, 106];

type Logo = { data: string; w: number; h: number } | null;

function periodLabel(report: BuiltReport, locale: Locale) {
  const { from, to } = report.period;
  if (!from && !to) return locale === "fr" ? "Toute la période" : "All dates";
  return `${from ? formatDate(from, locale) : "…"} – ${to ? formatDate(to, locale) : "…"}`;
}

/** The brochure's look: a charcoal page, an orange corner and a fine gold line running across it. */
function paintCover(pdf: jsPDF, report: BuiltReport, locale: Locale, logo: Logo) {
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const fr = locale === "fr";
  pdf.setFillColor(...CHARCOAL);
  pdf.rect(0, 0, w, h, "F");
  // slate panel and orange corner, like the brochure panels
  pdf.setFillColor(...SLATE);
  pdf.rect(0, h * 0.62, w, h * 0.38, "F");
  pdf.setFillColor(...ORANGE);
  pdf.rect(0, 0, 46, 14, "F");
  pdf.rect(w - 64, h - 22, 64, 22, "F");
  pdf.setDrawColor(...ORANGE);
  pdf.setLineWidth(0.35);
  pdf.line(w * 0.25, 0, w, h * 0.78);

  if (logo) {
    // the wordmark is dark: it sits on a white plate so it reads on the charcoal page
    const lh = 18;
    const lw = (lh * logo.w) / logo.h;
    pdf.setFillColor(...WHITE);
    pdf.rect(14, 24, lw + 8, lh + 8, "F");
    pdf.addImage(logo.data, "PNG", 18, 28, lw, lh, undefined, "FAST");
  } else {
    pdf.setTextColor(...WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(26);
    pdf.text("FRX", 18, 40);
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...ORANGE);
  pdf.text(fr ? "LIVRET DE RAPPORT" : "REPORT BOOKLET", 18, 82, { charSpace: 1.6 });
  pdf.setFontSize(30);
  pdf.setTextColor(...WHITE);
  const title = pdf.splitTextToSize(report.title.toUpperCase(), w - 40) as string[];
  pdf.text(title, 18, 96, { charSpace: 0.5 });
  let y = 96 + title.length * 12;
  pdf.setFillColor(...ORANGE);
  pdf.rect(18, y - 4, 22, 1.4, "F");

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(15);
  pdf.setTextColor(...WHITE);
  const scope = pdf.splitTextToSize(report.scopeLabel, w - 40) as string[];
  pdf.text(scope, 18, y + 8);
  y += 8 + scope.length * 7;
  if (report.scopeNumber) {
    pdf.setFontSize(10);
    pdf.setTextColor(...ORANGE);
    pdf.text(report.scopeNumber, 18, y + 1);
  }

  // facts block on the slate panel
  const top = h * 0.62 + 16;
  const facts: [string, string][] = [
    [fr ? "PÉRIODE" : "PERIOD", periodLabel(report, locale)],
    ["CLIENT", report.client?.company_name ?? (report.scopeNumber ? "—" : fr ? "Plusieurs clients" : "Several clients")],
    [fr ? "PRÉPARÉ PAR" : "PREPARED BY", report.preparedBy || "—"],
    [fr ? "DATE" : "DATE", formatDate(report.preparedOn, locale)],
  ];
  facts.forEach(([label, value], i) => {
    const x = 18 + (i % 2) * 92;
    const fy = top + Math.floor(i / 2) * 22;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(...ORANGE);
    pdf.text(label, x, fy, { charSpace: 1.2 });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.setTextColor(...WHITE);
    pdf.text(pdf.splitTextToSize(value, 84) as string[], x, fy + 6);
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...WHITE);
  pdf.text(report.company.legal_name, 18, h - 10);
}

function pageFrame(pdf: jsPDF, report: BuiltReport, logo: Logo) {
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setFillColor(...PAPER);
  pdf.rect(0, 0, w, h, "F");
  pdf.setFillColor(...CHARCOAL);
  pdf.rect(0, 0, w, 14, "F");
  pdf.setFillColor(...ORANGE);
  pdf.rect(0, 14, w, 1.2, "F");
  if (logo) {
    const lh = 6.4;
    const lw = (lh * logo.w) / logo.h;
    pdf.setFillColor(...WHITE);
    pdf.rect(12, 2.2, lw + 4, lh + 2.6, "F");
    pdf.addImage(logo.data, "PNG", 14, 3.6, lw, lh, undefined, "FAST");
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...ORANGE);
  pdf.text([report.scopeNumber, report.scopeLabel].filter(Boolean).join("  ·  ").toUpperCase(), w - 14, 9, { align: "right", charSpace: 0.8 });
}

function footer(pdf: jsPDF, page: number, total: number, report: BuiltReport, locale: Locale) {
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setFillColor(...CHARCOAL);
  pdf.rect(0, h - 10, w, 10, "F");
  pdf.setFillColor(...ORANGE);
  pdf.rect(0, h - 10, 22, 10, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...CHARCOAL);
  pdf.text(String(page), 11, h - 3.6, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...WHITE);
  pdf.text(`${report.company.legal_name}  ·  ${periodLabel(report, locale)}`, 28, h - 3.6);
  pdf.text(`${page} / ${total}`, w - 14, h - 3.6, { align: "right" });
}

export async function buildReportPdf(report: BuiltReport, locale: Locale) {
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const logo = await logoImage();
  const fr = locale === "fr";

  paintCover(pdf, report, locale, logo);

  report.sections.forEach((section) => {
    pdf.addPage();
    pageFrame(pdf, report, logo);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(19);
    pdf.setTextColor(...CHARCOAL);
    pdf.text(section.title.toUpperCase(), 16, 31, { charSpace: 0.6 });
    pdf.setFillColor(...ORANGE);
    pdf.rect(16, 34, 18, 1.2, "F");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(...SLATE);
    const summary = pdf.splitTextToSize(section.summary || "—", w - 32) as string[];
    pdf.text(summary, 16, 42);

    let y = 42 + summary.length * 5 + 8;
    if (section.rows.length === 0) {
      pdf.setTextColor(...MUTED);
      pdf.text(fr ? "Aucune donnée pour cette section sur la période choisie." : "No records for this section in the chosen period.", 16, y);
      return;
    }
    section.rows.forEach((row, index) => {
      const label = pdf.splitTextToSize(row.label, 80) as string[];
      const value = pdf.splitTextToSize(row.value, w - 112) as string[];
      const rowH = Math.max(label.length, value.length) * 4.4 + 4;
      if (y + rowH > h - 18) {
        pdf.addPage();
        pageFrame(pdf, report, logo);
        y = 28;
      }
      if (index % 2 === 0) {
        pdf.setFillColor(...ZEBRA);
        pdf.rect(14, y - 4.2, w - 28, rowH, "F");
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...CHARCOAL);
      pdf.text(label, 16, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...SLATE);
      pdf.text(value, 98, y);
      y += rowH;
    });
  });

  const total = pdf.getNumberOfPages();
  for (let i = 2; i <= total; i += 1) {
    pdf.setPage(i);
    footer(pdf, i, total, report, locale);
  }
  return pdf;
}

function fileName(report: BuiltReport) {
  const slug = report.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${report.scopeNumber || "FRX"}-${slug || "report"}.pdf`;
}

export async function downloadReportPdf(report: BuiltReport, locale: Locale) {
  const pdf = await buildReportPdf(report, locale);
  downloadBlob(pdf.output("blob"), fileName(report));
}

export async function reportPdfBase64(report: BuiltReport, locale: Locale) {
  return (await buildReportPdf(report, locale)).output("datauristring").split(",")[1] ?? "";
}
