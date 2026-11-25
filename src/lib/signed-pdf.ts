import type { SignField } from "@/lib/sign-fields";

/** Characters Helvetica (WinAnsi) can draw; anything else is dropped so a strange name never stops the file from being made. */
const printable = (text: string) => text.replace(/[^\x20-\x7E -ÿ]/g, "");

/**
 * The quote's own PDF with the client's signature and the date and time of acceptance drawn in the boxes the staff placed.
 * The original pages stay as they are (text and images are not flattened).
 */
export async function buildSignedPdf(url: string, fields: SignField[], signed: { signature: string; dateText: string; name?: string | null }): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("fetch");
  const pdf = await PDFDocument.load(await res.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const image = signed.signature.startsWith("data:image/jpeg") ? await pdf.embedJpg(signed.signature) : await pdf.embedPng(signed.signature);

  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const x = f.x * W;
    const w = f.w * W;
    const h = f.h * H;
    const y = H - (f.y + f.h) * H; // the boxes are measured from the top of the page, the PDF from the bottom
    if (f.type === "signature") {
      const scale = Math.min(w / image.width, h / image.height);
      const dw = image.width * scale;
      const dh = image.height * scale;
      page.drawImage(image, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
      if (signed.name) page.drawText(printable(`Signé électroniquement par ${signed.name}`), { x, y: Math.max(y - 8, 2), size: 6.5, font, color: rgb(0.35, 0.35, 0.35) });
    } else {
      const text = printable(signed.dateText);
      let size = Math.min(12, h * 0.7);
      while (size > 5 && font.widthOfTextAtSize(text, size) > w) size -= 0.5;
      page.drawText(text, { x, y: y + (h - size) / 2 + size * 0.15, size, font, color: rgb(0.05, 0.05, 0.05) });
    }
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
