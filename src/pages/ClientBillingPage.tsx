import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { FileText, PenLine, Printer, Receipt, X } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { acceptQuote, setQuoteStatus } from "@/lib/billing";
import { formatDate, money } from "@/lib/format";
import { invoiceTitle } from "@/lib/invoice";
import { downloadInvoicePdf, printInvoice } from "@/lib/invoice-pdf";
import { getCompanyProfile } from "@/lib/settings";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { InvoicePreview } from "@/components/InvoicePreview";
import { QuoteSignDialog } from "@/components/QuoteSignDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type { BillingDocument, Client, CompanyProfile, Project } from "@/lib/types";

export function ClientBillingPage() {
  const { clientId } = useParams();
  const id = Number(clientId);
  const { user, can } = useAuth();
  const { clients } = useWorkspace();
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [docs, setDocs] = useState<BillingDocument[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [preview, setPreview] = useState<BillingDocument | null>(null);
  const [signing, setSigning] = useState<BillingDocument | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const canView = Boolean(user?.is_admin || can("billing", "view") || user?.user_type === "external");
  const canDecide = Boolean(user?.user_type === "external");

  async function load() {
    // Always leave the loading state, even if a query fails, so the page
    // never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
      if (!rows[0]) {
        setClient(null);
        setLoading(false);
        return;
      }
      const jobs = (await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.client_id, id))) as Project[];
      const bills = (await db
        .select()
        .from(schema.billing_documents)
        .where(eq(schema.billing_documents.client_id, id))) as BillingDocument[];
      setClient(rows[0] as Client);
      setProjects(jobs);
      setDocs(bills.sort((a, b) => String(b.issued_on ?? "").localeCompare(String(a.issued_on ?? ""))));
      setCompany(await getCompanyProfile());
      setLoading(false);
    } catch (err) {
      console.error("ClientBillingPage load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const invoices = useMemo(() => docs.filter((d) => d.kind === "invoice"), [docs]);
  const quotes = useMemo(() => docs.filter((d) => d.kind === "quote"), [docs]);
  const workspaceClient = clients.find((c) => c.id === id) ?? client;

  async function rejectQuote(quote: BillingDocument) {
    setBusyId(quote.id);
    await setQuoteStatus(quote.id, "rejected");
    await logActivity({
      action: "rejected quote",
      details: quote.number,
      clientId: id,
      userId: user?.id,
    });
    setBusyId(null);
    setPreview((current) => (current?.id === quote.id ? { ...current, status: "rejected" } : current));
    await load();
  }

  async function signQuote(input: { signerName: string; signature: string }) {
    if (!signing) return;
    setBusyId(signing.id);
    const accepted = await acceptQuote(signing, {
      signerName: input.signerName,
      signature: input.signature,
      signedAt: new Date().toISOString(),
    });
    await logActivity({
      action: "approved quote",
      details: `${accepted.number} signed by ${input.signerName}`,
      clientId: id,
      userId: user?.id,
    });
    setBusyId(null);
    setSigning(null);
    setPreview(accepted);
    await load();
  }

  function exportPdf(doc: BillingDocument) {
    if (!company || !workspaceClient) return;
    void downloadInvoicePdf({
      doc,
      client: workspaceClient,
      project: projects.find((p) => p.id === doc.project_id) ?? null,
      company,
      locale,
    });
  }

  function printDoc(doc: BillingDocument) {
    if (!company || !workspaceClient) return;
    printInvoice({
      doc,
      client: workspaceClient,
      project: projects.find((p) => p.id === doc.project_id) ?? null,
      company,
      locale,
    });
  }

  if (loading) return <PageSkeleton />;
  if (!canView) {
    return (
      <EmptyState
        icon={<Receipt className="size-5" />}
        title={t("billing.restricted")}
        description={t("billing.restrictedDesc")}
      />
    );
  }
  if (!workspaceClient || !company) {
    return (
      <EmptyState
        icon={<Receipt className="size-5" />}
        title={t("clients.notFound")}
        description={t("clients.notFoundDesc")}
        action={
          <Button asChild variant="outline">
            <Link to="/">{t("nav.dashboard")}</Link>
          </Button>
        }
      />
    );
  }

  const outstanding = invoices.filter((d) => d.status !== "paid").reduce((sum, d) => sum + d.amount, 0);
  const paid = invoices.filter((d) => d.status === "paid").reduce((sum, d) => sum + d.amount, 0);
  const quoted = quotes.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div>
      <PageHeader
        eyebrow={workspaceClient.company_name}
        title={t("billing.title")}
        description={t("billing.desc", { company: workspaceClient.company_name })}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard label={t("billing.stat.invoiced")} value={money(paid + outstanding, locale)} hint={t("billing.stat.paidHint", { amount: money(paid, locale) })} />
        <SummaryCard label={t("billing.stat.outstanding")} value={money(outstanding, locale)} hint={t("billing.stat.invoiceCount", { n: invoices.length })} />
        <SummaryCard label={t("billing.stat.quotes")} value={money(quoted, locale)} hint={t("billing.stat.quoteCount", { n: quotes.length })} />
      </div>

      <Tabs defaultValue="invoices" className="gap-5">
        <TabsList>
          <TabsTrigger value="invoices">
            <Receipt className="size-3.5" />
            {t("billing.tab.invoices")}
          </TabsTrigger>
          <TabsTrigger value="quotes">
            <FileText className="size-3.5" />
            {t("billing.tab.quotes")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <ReadOnlyList
            rows={invoices}
            projects={projects}
            emptyTitle={t("billing.empty.invoices")}
            emptyDesc={t("billing.empty.invoicesDesc")}
            kind="invoice"
            onOpen={setPreview}
            onPdf={exportPdf}
          />
        </TabsContent>
        <TabsContent value="quotes">
          <ReadOnlyList
            rows={quotes}
            projects={projects}
            emptyTitle={t("billing.empty.quotes")}
            emptyDesc={t("billing.empty.quotesDesc")}
            kind="quote"
            canDecide={canDecide}
            busyId={busyId}
            onAccept={setSigning}
            onReject={(row) => void rejectQuote(row)}
            onOpen={setPreview}
            onPdf={exportPdf}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {preview ? `${invoiceTitle(preview.kind, locale)} ${preview.number}` : t("billing.preview")}
            </DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-end gap-2">
                {canDecide && preview.kind === "quote" && (preview.status === "sent" || preview.status === "draft") ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === preview.id}
                      onClick={() => void rejectQuote(preview)}
                    >
                      <X className="size-3.5" />
                      {t("billing.reject")}
                    </Button>
                    <Button size="sm" disabled={busyId === preview.id} onClick={() => setSigning(preview)}>
                      <PenLine className="size-3.5" />
                      {t("billing.approve")}
                    </Button>
                  </>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => printDoc(preview)}>
                  <Printer className="size-3.5" />
                  {t("billing.exportPdf")}
                </Button>
              </div>
              <InvoicePreview
                doc={preview}
                client={workspaceClient}
                project={projects.find((p) => p.id === preview.project_id) ?? null}
                company={company}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <QuoteSignDialog
        quote={signing}
        companyName={workspaceClient.company_name}
        defaultName={user?.name ?? ""}
        busy={busyId === signing?.id}
        onCancel={() => setSigning(null)}
        onSubmit={(input) => void signQuote(input)}
      />
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function ReadOnlyList({
  rows,
  projects,
  emptyTitle,
  emptyDesc,
  kind,
  canDecide,
  busyId,
  onAccept,
  onReject,
  onOpen,
  onPdf,
}: {
  rows: BillingDocument[];
  projects: Project[];
  emptyTitle: string;
  emptyDesc: string;
  kind: "invoice" | "quote";
  canDecide?: boolean;
  busyId?: number | null;
  onAccept?: (row: BillingDocument) => void;
  onReject?: (row: BillingDocument) => void;
  onOpen?: (row: BillingDocument) => void;
  onPdf?: (row: BillingDocument) => void;
}) {
  const { t, locale } = useI18n();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={kind === "invoice" ? <Receipt className="size-5" /> : <FileText className="size-5" />}
        title={emptyTitle}
        description={emptyDesc}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("billing.number")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.docTitle")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.project")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.issued")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.due")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("billing.amount")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.status")}</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const pending = row.status === "sent" || row.status === "draft";
            return (
              <tr key={row.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onOpen?.(row)}>
                <td className="px-4 py-3 font-medium tabular-nums">{row.number}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.title}</p>
                  {row.description ? <p className="text-xs text-muted-foreground">{row.description}</p> : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {projects.find((p) => p.id === row.project_id)?.name ?? t("billing.noProject")}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(row.issued_on, locale)}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(row.due_on, locale)}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{money(row.amount, locale)}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    {kind === "quote" && canDecide && pending ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.id}
                          onClick={() => onReject?.(row)}
                        >
                          <X className="size-3.5" />
                          {t("billing.reject")}
                        </Button>
                        <Button size="sm" disabled={busyId === row.id} onClick={() => onAccept?.(row)}>
                          <PenLine className="size-3.5" />
                          {t("billing.approve")}
                        </Button>
                      </>
                    ) : kind === "quote" && row.status === "accepted" ? (
                      <span className="self-center text-xs text-muted-foreground">
                        {row.signed_by
                          ? t("billing.signedHint", { name: row.signed_by })
                          : t("status.accepted")}
                      </span>
                    ) : kind === "quote" && row.status === "converted" ? (
                      <span className="self-center text-xs text-muted-foreground">{t("billing.convertedHint")}</span>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => onPdf?.(row)}>
                      <Printer className="size-3.5" />
                      {t("billing.exportPdf")}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
