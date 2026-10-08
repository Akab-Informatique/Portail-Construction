import { jsPDF } from "jspdf";
import { downloadBlob } from "./download";
import { formatDate, moneyExact } from "./format";
import { documentTotals, formatAddress, invoiceTitle, lineAmount, parseLines } from "./invoice";
import type { BillingDocument, Client, CompanyProfile, Locale, Project, QuoteChange } from "./types";

const YELLOW: [number, number, number] = [251, 170, 25];
const BLACK: [number, number, number] = [0, 0, 0];
const CONCRETE: [number, number, number] = [81, 81, 78];
const PALE: [number, number, number] = [209, 211, 212];
const PAPER: [number, number, number] = [255, 255, 255];

function money(value: number, locale: Locale) {
  return moneyExact(value, locale);
}

/** Annexes (client change requests priced by FRX) that are added after the quote pages. */
function addAnnexPages(pdf: jsPDF, doc: BillingDocument, changes: QuoteChange[], company: CompanyProfile, locale: Locale) {
  const isFr = locale === "fr";
  const pageW = pdf.internal.pageSize.getWidth();
  for (const change of changes) {
    pdf.addPage();
    const lines = parseLines(change.line_items);
    pdf.setFillColor(...YELLOW);
    pdf.rect(0, 0, pageW, 6, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...BLACK);
    pdf.setFontSize(22);
    pdf.text(isFr ? "ANNEXE" : "ANNEX", 16, 22);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.setTextColor(...CONCRETE);
    pdf.text(`Nº ${change.number}  ·  ${isFr ? "Soumission" : "Quote"} ${doc.number}`, 16, 29);
    pdf.setDrawColor(...PALE);
    pdf.line(16, 34, pageW - 16, 34);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(...BLACK);
    pdf.text(change.title, 16, 44, { maxWidth: pageW - 32 });
    let y = 52;
    if (change.description) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(...CONCRETE);
      const wrapped = pdf.splitTextToSize(change.description, pageW - 32) as string[];
      pdf.text(wrapped, 16, y);
      y += wrapped.length * 5 + 4;
    }

    if (lines.length > 0) {
      pdf.setFillColor(...BLACK);
      pdf.rect(16, y, pageW - 32, 8, "F");
      pdf.setTextColor(...PAPER);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text("DESCRIPTION", 18, y + 5.5);
      pdf.text(isFr ? "QTÉ" : "QTY", 128, y + 5.5, { align: "right" });
      pdf.text(isFr ? "P.U." : "UNIT", 156, y + 5.5, { align: "right" });
      pdf.text(isFr ? "MONTANT" : "AMOUNT", pageW - 18, y + 5.5, { align: "right" });
      let rowY = y + 14;
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...BLACK);
      pdf.setFontSize(9);
      lines.forEach((line, i) => {
        if (i % 2 === 1) {
          pdf.setFillColor(248, 248, 247);
          pdf.rect(16, rowY - 5, pageW - 32, 8, "F");
        }
        pdf.text(line.description || "—", 18, rowY);
        pdf.text(`${line.quantity} ${line.unit}`, 128, rowY, { align: "right" });
        pdf.text(money(line.unit_price, locale), 156, rowY, { align: "right" });
        pdf.text(money(lineAmount(line), locale), pageW - 18, rowY, { align: "right" });
        rowY += 8;
      });
      pdf.setDrawColor(...PALE);
      pdf.line(16, rowY, pageW - 16, rowY);
      const boxX = 122;
      let ty = rowY + 8;
      const rows: [string, number][] = [
        [isFr ? "Sous-total" : "Subtotal", change.subtotal ?? 0],
        ["TPS / GST 5 %", change.tax_gst ?? 0],
        ["TVQ / QST 9.975 %", change.tax_qst ?? 0],
      ];
      pdf.setFontSize(9);
      rows.forEach(([label, value]) => {
        pdf.setTextColor(...CONCRETE);
        pdf.text(label, boxX, ty);
        pdf.setTextColor(...BLACK);
        pdf.text(money(value, locale), pageW - 18, ty, { align: "right" });
        ty += 6;
      });
      pdf.setFillColor(...YELLOW);
      pdf.rect(boxX - 4, ty - 4, pageW - boxX - 12, 10, "F");
      pdf.setTextColor(...BLACK);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text("TOTAL", boxX, ty + 3);
      pdf.text(money(change.amount, locale), pageW - 18, ty + 3, { align: "right" });
      y = ty + 18;
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...CONCRETE);
    if (change.status === "approved") {
      pdf.text(isFr ? "APPROUVÉE ET SIGNÉE PAR" : "APPROVED AND SIGNED BY", 16, y);
      if (change.signature) {
        try {
          pdf.addImage(change.signature, "PNG", 16, y + 2, 46, 16);
        } catch {
          /* ignore invalid signature image */
        }
      }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...BLACK);
      pdf.text(change.signed_by || "", 16, y + 22);
      if (change.decided_at) {
        pdf.setTextColor(...CONCRETE);
        pdf.setFontSize(8);
        pdf.text(formatDate(change.decided_at, locale), 16, y + 26);
      }
    } else {
      pdf.text(isFr ? "EN ATTENTE D’APPROBATION DU CLIENT" : "AWAITING CLIENT APPROVAL", 16, y);
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...CONCRETE);
    pdf.text(`${isFr ? "TPS" : "GST"} ${company.gst}   ${isFr ? "TVQ" : "QST"} ${company.qst}`, 16, 236);
    pdf.setFillColor(...YELLOW);
    pdf.rect(0, 271, pageW, 4, "F");
    pdf.text("FRX Construction  ·  frxconstruction.ca", pageW / 2, 277, { align: "center" });
  }
}

export function buildInvoicePdf(opts: {
  doc: BillingDocument;
  client: Client;
  project?: Project | null;
  company: CompanyProfile;
  locale: Locale;
  /** Quote annexes to append (only priced ones are printed). */
  changes?: QuoteChange[];
}) {
  const { doc, client, project, company, locale } = opts;
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const totals = documentTotals(doc);
  const isFr = locale === "fr";
  const kindLabel = invoiceTitle(doc.kind, locale);

  pdf.setFillColor(...PAPER);
  pdf.rect(0, 0, pageW, pdf.internal.pageSize.getHeight(), "F");

  pdf.setFillColor(...YELLOW);
  pdf.rect(0, 0, pageW, 6, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...BLACK);
  pdf.setFontSize(28);
  pdf.text("FRX", 16, 22);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...YELLOW);
  pdf.text("CONSTRUCTION", 16, 27);

  pdf.setTextColor(...BLACK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(kindLabel, pageW - 16, 20, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(...CONCRETE);
  pdf.text(`Nº ${doc.number}`, pageW - 16, 27, { align: "right" });

  pdf.setDrawColor(...PALE);
  pdf.setLineWidth(0.3);
  pdf.line(16, 33, pageW - 16, 33);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...CONCRETE);
  pdf.text(isFr ? "DE" : "FROM", 16, 41);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...BLACK);
  pdf.setFontSize(10);
  let y = 46;
  pdf.text(company.legal_name, 16, y);
  y += 5;
  pdf.text(company.address, 16, y);
  y += 5;
  pdf.text(`${company.city} ${company.province}  ${company.postal}`, 16, y);
  y += 5;
  pdf.text(company.phone, 16, y);
  y += 5;
  pdf.text(company.email, 16, y);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...CONCRETE);
  pdf.text(isFr ? "FACTURER À" : "BILL TO", 110, 41);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...BLACK);
  pdf.setFontSize(10);
  let cy = 46;
  pdf.text(client.company_name, 110, cy);
  cy += 5;
  pdf.text(client.name, 110, cy);
  for (const line of formatAddress(client)) {
    cy += 5;
    pdf.text(line, 110, cy);
  }
  if (client.email) {
    cy += 5;
    pdf.text(client.email, 110, cy);
  }

  const metaTop = Math.max(y, cy) + 10;
  pdf.setFillColor(244, 244, 243);
  pdf.rect(16, metaTop, pageW - 32, 16, "F");
  const cols = [
    [isFr ? "Date" : "Date", formatDate(doc.issued_on, locale)],
    [isFr ? "Échéance" : "Due", formatDate(doc.due_on, locale)],
    [isFr ? "Bon de commande" : "P.O.", doc.po_number || "—"],
    [isFr ? "Projet" : "Project", project?.project_number || "—"],
  ];
  cols.forEach(([label, value], i) => {
    const x = 20 + i * 48;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(...CONCRETE);
    pdf.text(label.toUpperCase(), x, metaTop + 6);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(...BLACK);
    pdf.text(String(value), x, metaTop + 12);
  });

  const tableTop = metaTop + 24;
  pdf.setFillColor(...BLACK);
  pdf.rect(16, tableTop, pageW - 32, 8, "F");
  pdf.setTextColor(...PAPER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text(isFr ? "DESCRIPTION" : "DESCRIPTION", 18, tableTop + 5.5);
  pdf.text(isFr ? "QTÉ" : "QTY", 128, tableTop + 5.5, { align: "right" });
  pdf.text(isFr ? "P.U." : "UNIT", 156, tableTop + 5.5, { align: "right" });
  pdf.text(isFr ? "MONTANT" : "AMOUNT", pageW - 18, tableTop + 5.5, { align: "right" });

  let rowY = tableTop + 14;
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...BLACK);
  totals.lines.forEach((line, index) => {
    if (index % 2 === 1) {
      pdf.setFillColor(248, 248, 247);
      pdf.rect(16, rowY - 5, pageW - 32, 8, "F");
    }
    pdf.setFontSize(9);
    pdf.text(line.description || "—", 18, rowY);
    pdf.text(`${line.quantity} ${line.unit}`, 128, rowY, { align: "right" });
    pdf.text(money(line.unit_price, locale), 156, rowY, { align: "right" });
    pdf.text(money(lineAmount(line), locale), pageW - 18, rowY, { align: "right" });
    rowY += 8;
  });

  pdf.setDrawColor(...PALE);
  pdf.line(16, rowY, pageW - 16, rowY);

  const boxX = 122;
  let ty = rowY + 8;
  const rows = [
    [isFr ? "Sous-total" : "Subtotal", money(totals.subtotal, locale)],
    ["TPS / GST 5 %", money(totals.tax_gst, locale)],
    ["TVQ / QST 9.975 %", money(totals.tax_qst, locale)],
  ];
  pdf.setFontSize(9);
  rows.forEach(([label, value]) => {
    pdf.setTextColor(...CONCRETE);
    pdf.text(label, boxX, ty);
    pdf.setTextColor(...BLACK);
    pdf.text(value, pageW - 18, ty, { align: "right" });
    ty += 6;
  });
  pdf.setFillColor(...YELLOW);
  pdf.rect(boxX - 4, ty - 4, pageW - boxX - 12, 10, "F");
  pdf.setTextColor(...BLACK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(isFr ? "TOTAL" : "TOTAL", boxX, ty + 3);
  pdf.text(money(totals.amount, locale), pageW - 18, ty + 3, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...CONCRETE);
  pdf.text(`${isFr ? "TPS" : "GST"} ${company.gst}   ${isFr ? "TVQ" : "QST"} ${company.qst}`, 16, 236);
  if (doc.signed_by || doc.signature) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...CONCRETE);
    pdf.text(isFr ? "ACCEPTÉE ET SIGNÉE PAR" : "ACCEPTED AND SIGNED BY", 16, 244);
    if (doc.signature) {
      try {
        pdf.addImage(doc.signature, "PNG", 16, 246, 46, 16);
      } catch {
        /* ignore invalid signature image */
      }
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...BLACK);
    pdf.text(doc.signed_by || "", 16, 266);
    if (doc.signed_at) {
      pdf.setTextColor(...CONCRETE);
      pdf.setFontSize(8);
      pdf.text(formatDate(doc.signed_at, locale), 16, 270);
    }
  }
  if (doc.notes) {
    pdf.setTextColor(...BLACK);
    pdf.setFontSize(9);
    pdf.text(isFr ? "Notes" : "Notes", 110, 244);
    pdf.setTextColor(...CONCRETE);
    pdf.text(doc.notes, 110, 249, { maxWidth: 84 });
  }
  pdf.setFillColor(...YELLOW);
  pdf.rect(0, 271, pageW, 4, "F");
  pdf.setFontSize(8);
  pdf.setTextColor(...CONCRETE);
  pdf.text("FRX Construction  ·  frxconstruction.ca", pageW / 2, 277, { align: "center" });

  const annexes = (opts.changes ?? []).filter((c) => c.status === "proposed" || c.status === "approved");
  if (annexes.length > 0) addAnnexPages(pdf, doc, annexes, company, locale);

  return pdf;
}

export async function downloadInvoicePdf(opts: {
  doc: BillingDocument;
  client: Client;
  project?: Project | null;
  company: CompanyProfile;
  locale: Locale;
  changes?: QuoteChange[];
}) {
  const pdf = buildInvoicePdf(opts);
  const blob = pdf.output("blob");
  downloadBlob(blob, `${opts.doc.kind}-${opts.doc.number}.pdf`);
}

export function printInvoice(opts: {
  doc: BillingDocument;
  client: Client;
  project?: Project | null;
  company: CompanyProfile;
  locale: Locale;
  changes?: QuoteChange[];
}) {
  const pdf = buildInvoicePdf(opts);
  const url = pdf.output("bloburl");
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = String(url);
  document.body.appendChild(frame);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(frame);
      URL.revokeObjectURL(String(url));
    }, 1500);
  };
}

export function invoicePdfBase64(opts: {
  doc: BillingDocument;
  client: Client;
  project?: Project | null;
  company: CompanyProfile;
  locale: Locale;
  changes?: QuoteChange[];
}) {
  return buildInvoicePdf(opts).output("datauristring").split(",")[1] ?? "";
}
