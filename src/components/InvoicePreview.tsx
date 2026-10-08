import { formatDate, moneyExact } from "@/lib/format";
import { documentTotals, formatAddress, invoiceTitle, lineAmount } from "@/lib/invoice";
import { Logo } from "@/components/Logo";
import { useI18n } from "@/lib/i18n";
import type { BillingDocument, Client, CompanyProfile, Project } from "@/lib/types";

export function InvoicePreview({
  doc,
  client,
  project,
  company,
}: {
  doc: BillingDocument;
  client: Client;
  project?: Project | null;
  company: CompanyProfile;
}) {
  const { t, locale } = useI18n();
  const totals = documentTotals(doc);

  return (
    <div className="overflow-hidden rounded-sm border bg-white text-black shadow-sm">
      <div className="h-1.5 bg-[#fbaa19]" />
      <div className="px-8 py-7">
        <div className="flex items-start justify-between gap-6">
          <Logo className="h-12" />
          <div className="text-right">
            <p className="font-display text-2xl font-semibold uppercase tracking-[0.12em]">
              {invoiceTitle(doc.kind, locale)}
            </p>
            <p className="mt-1 text-sm text-[#51514e]">Nº {doc.number}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-8 border-t border-[#d1d3d4] pt-6 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#51514e]">{t("invoice.from")}</p>
            <p className="mt-2 font-medium">{company.legal_name}</p>
            <p className="text-sm text-[#51514e]">{company.address}</p>
            <p className="text-sm text-[#51514e]">
              {company.city} {company.province} {company.postal}
            </p>
            <p className="text-sm text-[#51514e]">{company.phone}</p>
            <p className="text-sm text-[#51514e]">{company.email}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#51514e]">{t("invoice.billTo")}</p>
            <p className="mt-2 font-medium">{client.company_name}</p>
            <p className="text-sm text-[#51514e]">{client.name}</p>
            {formatAddress(client).map((line) => (
              <p key={line} className="text-sm text-[#51514e]">
                {line}
              </p>
            ))}
            {client.email ? <p className="text-sm text-[#51514e]">{client.email}</p> : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 bg-[#f4f4f3] px-4 py-3 text-sm sm:grid-cols-4">
          <Meta label={t("billing.issued")} value={formatDate(doc.issued_on, locale)} />
          <Meta label={t("billing.due")} value={formatDate(doc.due_on, locale)} />
          <Meta label={t("invoice.po")} value={doc.po_number || "—"} />
          <Meta label={t("billing.project")} value={project?.project_number || "—"} />
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="bg-black text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
              <th className="px-3 py-2 text-left">{t("invoice.col.description")}</th>
              <th className="px-3 py-2 text-right">{t("invoice.col.qty")}</th>
              <th className="px-3 py-2 text-right">{t("invoice.col.unit")}</th>
              <th className="px-3 py-2 text-right">{t("invoice.col.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((line, i) => (
              <tr key={`${line.description}-${i}`} className={i % 2 ? "bg-[#f8f8f7]" : ""}>
                <td className="px-3 py-2">{line.description || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {line.quantity} {line.unit}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{moneyExact(line.unit_price, locale)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneyExact(lineAmount(line), locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <TotalRow label={t("invoice.subtotal")} value={moneyExact(totals.subtotal, locale)} />
          <TotalRow label={t("invoice.gst")} value={moneyExact(totals.tax_gst, locale)} />
          <TotalRow label={t("invoice.qst")} value={moneyExact(totals.tax_qst, locale)} />
          <div className="flex items-center justify-between bg-[#fbaa19] px-3 py-2 font-display text-base font-semibold">
            <span>{t("invoice.total")}</span>
            <span className="tabular-nums">{moneyExact(totals.amount, locale)}</span>
          </div>
        </div>

        {doc.signed_by || doc.signature ? (
          <div className="mt-8 border-t border-[#d1d3d4] pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#51514e]">
              {t("invoice.signedBy")}
            </p>
            {doc.signature ? (
              <img src={doc.signature} alt="" className="mt-2 h-16 w-auto max-w-[240px] object-contain" />
            ) : null}
            <p className="mt-1 text-sm font-medium">{doc.signed_by}</p>
            {doc.signed_at ? (
              <p className="text-xs text-[#51514e]">{t("invoice.signedOn", { date: formatDate(doc.signed_at, locale) })}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 border-t border-[#d1d3d4] pt-4 text-[11px] text-[#51514e]">
          <p>
            {t("invoice.gstNo")} {company.gst} · {t("invoice.qstNo")} {company.qst}
          </p>
          {doc.notes ? <p className="mt-2 whitespace-pre-wrap">{doc.notes}</p> : null}
        </div>
      </div>
      <div className="h-1 bg-[#fbaa19]" />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#51514e]">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[#51514e]">
      <span>{label}</span>
      <span className="tabular-nums text-black">{value}</span>
    </div>
  );
}
