import { jsPDF } from "jspdf";
import { downloadBlob } from "./download";
import { logoImage } from "./schedule-pdf";
import { answerOf, photosOf, type FormData, type FormDef } from "./forms";
import type { PdfAttachment } from "./project-files";

export type FormPdfItem = {
  templateName: string;
  projectName: string;
  projectNumber: string;
  /** The day the form is for (YYYY-MM-DD). */
  date: string;
  def: FormDef;
  data: FormData;
  filledBy?: string;
  /** Documents and photos attached to the form: photos are printed after the answers, other files are listed. */
  files?: PdfAttachment[];
  /** A numbered form (a work order): its number and the wording of the line that shows it. */
  number?: string | null;
  numberLabel?: string;
};

/** The company block printed beside the logo. */
const FRX_INFO = ["Construction FRX inc.", "102-2250, rue Antonio-Héroux", "Terrebonne (QC) J6X 4T8", "450 477-9937 · info@frxconstruction.ca", "RBQ : 5588-1809-01"];
const FRX_DARK: [number, number, number] = [20, 20, 20];
const FRX_ORANGE: [number, number, number] = [251, 170, 25];

export type FormPdfLabels = { formTitle: string; project: string; date: string; type: string; filledBy: string; exportedOn: string; page: string; of: string; empty: string; attachments: string };

const RED: [number, number, number] = [228, 0, 43];
const INK: [number, number, number] = [40, 40, 38];
const MUTED: [number, number, number] = [95, 95, 92];
const LINE: [number, number, number] = [150, 190, 196];

/**
 * Filled forms as a PDF, one form after another, each starting on a new page: a grey title bar, the project, the date
 * and the type of form, then every section with its questions and answers. The FRX logo sits on the bar.
 */
export async function exportFormsPdf(input: { items: FormPdfItem[]; labels: FormPdfLabels; locale: string; fileName: string }) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;
  const innerW = W - M * 2;
  const labelW = innerW * 0.52;
  const logo = await logoImage();
  const { labels } = input;

  input.items.forEach((item, index) => {
    if (index > 0) pdf.addPage();
    let y = 0;

    // ---- header: the FRX colours (black with an orange edge), the logo and the company details, then the form's name ----
    pdf.setFillColor(...FRX_DARK);
    pdf.rect(0, 0, W, 84, "F");
    pdf.setFillColor(...FRX_ORANGE);
    pdf.rect(0, 84, W, 4, "F");
    if (logo) {
      const lh = 30;
      const lw = (lh * logo.w) / logo.h;
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(M, 12, lw + 16, lh + 10, 4, 4, "F");
      pdf.addImage(logo.data, "PNG", M + 8, 17, lw, lh, undefined, "FAST");
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.setTextColor(255, 255, 255);
    pdf.text(item.templateName.toUpperCase(), M, 70);
    FRX_INFO.forEach((line, i) => {
      pdf.setFont("helvetica", i === 0 ? "bold" : "normal");
      pdf.setFontSize(i === 0 ? 9.5 : 8);
      pdf.setTextColor(...(i === 0 ? FRX_ORANGE : ([225, 225, 225] as [number, number, number])));
      pdf.text(line, W - M, 22 + i * 11.5, { align: "right" });
    });

    // ---- who / when / what ----
    y = 112;
    const head: [string, string, boolean][] = [
      [labels.project, `${item.projectName}${item.projectNumber ? ` (${item.projectNumber})` : ""}`, false],
      [labels.date, item.date, false],
      item.number ? [item.numberLabel ?? labels.type, item.number, true] : [labels.type, item.templateName, true],
    ];
    if (item.filledBy) head.push([labels.filledBy, item.filledBy, false]);
    pdf.setFontSize(10);
    for (const [label, value, bold] of head) {
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...MUTED);
      pdf.text(label, M, y);
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setTextColor(...INK);
      pdf.text(pdf.splitTextToSize(value, innerW - labelW) as string[], W - M, y, { align: "right" });
      y += 16;
    }
    y += 6;

    const ensure = (need: number) => {
      if (y + need > H - 50) {
        pdf.addPage();
        y = 50;
      }
    };

    // ---- sections ----
    for (const section of item.def.sections) {
      const rows = item.data[section.id] ?? [];
      if (section.title) {
        ensure(34);
        y += 8;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(13);
        pdf.setTextColor(...RED);
        pdf.text(section.title.toUpperCase(), M, y);
        pdf.setDrawColor(190, 200, 202);
        pdf.setLineWidth(0.6);
        pdf.line(M, y + 4, W - M, y + 4);
        y += 20;
      }
      rows.forEach((row, rowIndex) => {
        if (section.repeat && rows.length > 1) {
          ensure(22);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(9);
          pdf.setTextColor(...MUTED);
          pdf.text(`#${rowIndex + 1}`, M, y);
          y += 12;
        }
        for (const fl of section.fields) {
          if (fl.type === "photo") {
            const photos = photosOf(row[fl.id]);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(9.5);
            const labelLines = pdf.splitTextToSize(fl.label, innerW) as string[];
            ensure(labelLines.length * 12 + 20);
            pdf.setTextColor(...MUTED);
            pdf.text(labelLines, M, y);
            y += labelLines.length * 12 + 2;
            if (photos.length === 0) {
              pdf.setFont("helvetica", "bold");
              pdf.setTextColor(...INK);
              pdf.text("—", M, y + 4);
              y += 16;
              continue;
            }
            // two pictures per row, each as large as the column allows
            const colW = (innerW - 10) / 2;
            for (let k = 0; k < photos.length; k += 2) {
              const pair = photos.slice(k, k + 2).flatMap((p) => {
                try {
                  const props = pdf.getImageProperties(p.data);
                  const scale = Math.min(colW / props.width, 210 / props.height, 1);
                  return [{ p, props, w: props.width * scale, h: props.height * scale }];
                } catch {
                  return [];
                }
              });
              if (pair.length === 0) continue;
              const rowH = Math.max(...pair.map((x) => x.h));
              ensure(rowH + 12);
              pair.forEach((x, n) => pdf.addImage(x.p.data, x.props.fileType, M + n * (colW + 10), y, x.w, x.h, undefined, "FAST"));
              y += rowH + 10;
            }
            pdf.setDrawColor(...LINE);
            pdf.setLineWidth(0.5);
            pdf.line(M, y, W - M, y);
            y += 12;
            continue;
          }
          const answer = answerOf(row, fl) || "—";
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(9.5);
          const labelLines = pdf.splitTextToSize(fl.label, fl.type === "longtext" ? innerW : labelW - 10) as string[];
          pdf.setFont("helvetica", "bold");
          const answerLines = pdf.splitTextToSize(answer, fl.type === "longtext" ? innerW : innerW - labelW) as string[];
          if (fl.type === "longtext") {
            const h = labelLines.length * 12 + answerLines.length * 12 + 12;
            ensure(h);
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(...MUTED);
            pdf.text(labelLines, M, y);
            y += labelLines.length * 12 + 2;
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(...INK);
            pdf.text(answerLines, M, y);
            y += answerLines.length * 12;
            pdf.setDrawColor(...LINE);
            pdf.setLineWidth(0.5);
            pdf.line(M, y, W - M, y);
            y += 12;
          } else {
            const lines = Math.max(labelLines.length, answerLines.length);
            const h = lines * 12 + 8;
            ensure(h);
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(...MUTED);
            pdf.text(labelLines, M, y);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(...INK);
            pdf.text(answerLines, W - M, y, { align: "right" });
            y += lines * 12;
            pdf.setDrawColor(...LINE);
            pdf.setLineWidth(0.5);
            pdf.line(M + labelW, y + 1, W - M, y + 1);
            y += 11;
          }
        }
        y += 4;
      });
    }

    // ---- attached documents and photos ----
    const files = item.files ?? [];
    if (files.length) {
      ensure(40);
      y += 8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(13);
      pdf.setTextColor(...RED);
      pdf.text(labels.attachments.toUpperCase(), M, y);
      pdf.setDrawColor(190, 200, 202);
      pdf.setLineWidth(0.6);
      pdf.line(M, y + 4, W - M, y + 4);
      y += 20;
      pdf.setFontSize(9.5);
      for (const f of files) {
        if (f.dataUrl) continue;
        ensure(16);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...INK);
        pdf.text(`•  ${f.name}`, M, y);
        y += 14;
      }
      for (const f of files) {
        if (!f.dataUrl) continue;
        try {
          const props = pdf.getImageProperties(f.dataUrl);
          const scale = Math.min(innerW / props.width, 300 / props.height, 1);
          const w = props.width * scale;
          const h = props.height * scale;
          ensure(h + 26);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8.5);
          pdf.setTextColor(...MUTED);
          pdf.text(f.name, M, y);
          y += 6;
          pdf.addImage(f.dataUrl, props.fileType, M, y, w, h, undefined, "FAST");
          y += h + 14;
        } catch {
          ensure(16);
          pdf.setFontSize(9.5);
          pdf.setTextColor(...INK);
          pdf.text(`•  ${f.name}`, M, y);
          y += 14;
        }
      }
    }
  });

  // ---- footers ----
  const pages = pdf.getNumberOfPages();
  const exported = new Intl.DateTimeFormat(input.locale, { dateStyle: "long", timeStyle: "short" }).format(new Date());
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(95, 95, 92);
    pdf.text(`${labels.exportedOn} ${exported}`, M, H - 22);
    pdf.text(`${labels.page} ${i} ${labels.of} ${pages}`, W - M, H - 22, { align: "right" });
  }
  downloadBlob(pdf.output("blob"), input.fileName.replace(/[\\/:*?"<>|]+/g, " "));
}
