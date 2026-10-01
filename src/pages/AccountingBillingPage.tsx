import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Download, FileText, Mail, Pencil, Plus, Printer, Receipt, Wallet } from "lucide-react";
import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { convertQuoteToInvoice, nextBillingNumber } from "@/lib/billing";
import { downloadBlob } from "@/lib/download";
import { formatDate, isoDate, money, todayISO } from "@/lib/format";
import { emptyLine, invoiceTitle, linesForDocument, serializeLines, totalsFromLines } from "@/lib/invoice";
import { downloadInvoicePdf, invoicePdfBase64, printInvoice } from "@/lib/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/mail";
import {
  applyEmailTemplate,
  getCompanyProfile,
  getEmailTemplates,
  getQuickBooksSettings,
  getSmtpSettings,
  smtpReady as smtpIsReady,
  templateKeyForKind,
} from "@/lib/settings";
import { exportQuickBooksBundle, type QuickBooksExportScope } from "@/lib/quickbooks";
import { loadAllPunches } from "@/lib/timeclock";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { InvoicePreview } from "@/components/InvoicePreview";
import { BillingEditor, type BillingForm } from "@/components/BillingEditor";
import { ComposeEmailDialog, type ComposeDraft } from "@/components/ComposeEmailDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type {
  BillingDocument,
  BillingKind,
  Client,
  CompanyProfile,
  EmailTemplates,
  Project,
  QuickBooksSettings,
  SmtpSettings,
  TimePunch,
  User,
} from "@/lib/types";

function blankForm(kind: BillingKind, docs: BillingDocument[], clientId: string): BillingForm {
  return {
    kind,
    number: nextBillingNumber(kind, docs),
    title: "",
    description: "",
    status: "draft",
    client_id: clientId,
    project_id: "none",
    issued_on: todayISO(),
    due_on: isoDate(30),
    notes: "",
    po_number: "",
    lines: [emptyLine()],
  };
}

function formFromDoc(doc: BillingDocument): BillingForm {
  return {
    kind: doc.kind,
    number: doc.number,
    title: doc.title,
    description: doc.description ?? "",
    status: doc.status,
    client_id: String(doc.client_id),
    project_id: doc.project_id ? String(doc.project_id) : "none",
    issued_on: doc.issued_on ?? todayISO(),
    due_on: doc.due_on ?? "",
    notes: doc.notes ?? "",
    po_number: doc.po_number ?? "",
    lines: linesForDocument(doc),
  };
}

export function AccountingBillingPage() {
  const { user, can, permissions } = useAuth();
  const { clients } = useWorkspace();
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<BillingDocument[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [smtp, setSmtp] = useState<SmtpSettings | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [preview, setPreview] = useState<BillingDocument | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BillingForm>(blankForm("invoice", [], ""));
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qbOpen, setQbOpen] = useState(false);
  const [qb, setQb] = useState<QuickBooksSettings | null>(null);
  const [qbScope, setQbScope] = useState<QuickBooksExportScope>("all");
  const [qbBusy, setQbBusy] = useState(false);
  const [punches, setPunches] = useState<TimePunch[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [templates, setTemplates] = useState<EmailTemplates | null>(null);
  const [compose, setCompose] = useState<{ doc: BillingDocument; draft: ComposeDraft } | null>(null);

  const groupBilling = permissions.some((p) => p.module === "billing" && Number(p.can_view) === 1);
  const canView = Boolean(user?.is_admin || groupBilling);
  const canManage = Boolean(
    user?.is_admin || (groupBilling && user?.user_type === "internal" && can("billing", "create")),
  );
  const homeClientId = clients[0]?.id;
  const mailReady = smtp ? smtpIsReady(smtp) : false;

  async function load() {
    try {
      await dbReady;
      const [billRows, clientRows, projectRows, companyProfile, smtpSettings, qbSettings, punchRows, userRows, emailTemplates] =
        await Promise.all([
          db.select().from(schema.billing_documents),
          db.select().from(schema.clients),
          db.select().from(schema.projects),
          getCompanyProfile(),
          getSmtpSettings(),
          getQuickBooksSettings(),
          loadAllPunches(),
          db.select().from(schema.users),
          getEmailTemplates(),
        ]);
      const bills = billRows as BillingDocument[];
      const cos = clientRows as Client[];
      const jobs = projectRows as Project[];
      const visibleIds = new Set(clients.map((c) => c.id));
      const scoped = user?.is_admin ? bills : bills.filter((d) => visibleIds.has(d.client_id));
      setDocs(scoped.sort((a, b) => String(b.issued_on ?? "").localeCompare(String(a.issued_on ?? ""))));
      setAllClients(user?.is_admin ? cos : cos.filter((c) => visibleIds.has(c.id)));
      setAllProjects(user?.is_admin ? jobs : jobs.filter((p) => visibleIds.has(p.client_id)));
      setCompany(companyProfile);
      setSmtp(smtpSettings);
      setQb(qbSettings);
      setPunches(punchRows);
      setPeople((userRows as User[]).filter((p) => p.user_type === "internal"));
      setTemplates(emailTemplates);
    } catch (err) {
      console.error("billing load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.length, user?.id]);

  const invoices = useMemo(() => docs.filter((d) => d.kind === "invoice"), [docs]);
  const quotes = useMemo(() => docs.filter((d) => d.kind === "quote"), [docs]);

  function openCreate(kind: BillingKind) {
    setEditingId(null);
    setForm(blankForm(kind, docs, allClients[0] ? String(allClients[0].id) : ""));
    setEditorOpen(true);
  }

  function openEdit(doc: BillingDocument) {
    setEditingId(doc.id);
    setForm(formFromDoc(doc));
    setPreview(null);
    setEditorOpen(true);
  }

  async function persist(status: "draft" | "sent") {
    if (!form.title.trim() || !form.number.trim() || !form.client_id) return null;
    const totals = totalsFromLines(form.lines);
    const payload = {
      client_id: Number(form.client_id),
      project_id: form.project_id === "none" ? null : Number(form.project_id),
      kind: form.kind,
      number: form.number.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      amount: totals.amount,
      status,
      issued_on: form.issued_on || todayISO(),
      due_on: form.due_on || null,
      notes: form.notes.trim() || null,
      source_quote_id: null as number | null,
      line_items: serializeLines(form.lines),
      subtotal: totals.subtotal,
      tax_gst: totals.tax_gst,
      tax_qst: totals.tax_qst,
      po_number: form.po_number.trim() || null,
    };
    setSaving(true);
    let saved: BillingDocument;
    if (editingId) {
      const [row] = await db
        .update(schema.billing_documents)
        .set(payload)
        .where(eq(schema.billing_documents.id, editingId))
        .returning();
      saved = row as BillingDocument;
    } else {
      const [row] = await db.insert(schema.billing_documents).values(payload).returning();
      saved = row as BillingDocument;
      setEditingId(saved.id);
    }
    await logActivity({
      action: form.kind === "invoice" ? "created invoice" : "created quote",
      details: saved.number,
      clientId: saved.client_id,
      userId: user?.id,
    });
    setSaving(false);
    await load();
    return saved;
  }

  async function onSaveDraft() {
    const saved = await persist("draft");
    if (saved) setEditorOpen(false);
  }

  async function onSend() {
    if (!smtp || !company) return;
    const saved = await persist("sent");
    if (!saved) return;
    const client = allClients.find((c) => c.id === saved.client_id);
    if (!client?.email) {
      setNotice(t("billing.noClientEmail"));
      return;
    }
    try {
      setSaving(true);
      await sendInvoiceEmail({
        smtp,
        to: client.email,
        subject: t("invoice.mail.subject", { kind: invoiceTitle(saved.kind, locale), number: saved.number }),
        text: t("invoice.mail.body", { kind: invoiceTitle(saved.kind, locale), number: saved.number }),
        filename: `${saved.kind}-${saved.number}.pdf`,
        pdfBase64: invoicePdfBase64({
          doc: saved,
          client,
          project: allProjects.find((p) => p.id === saved.project_id) ?? null,
          company,
          locale,
        }),
      });
      await db
        .update(schema.billing_documents)
        .set({ sent_at: todayISO(), sent_to: client.email, status: "sent" })
        .where(eq(schema.billing_documents.id, saved.id));
      await logActivity({
        action: saved.kind === "invoice" ? "sent invoice" : "sent quote",
        details: `${saved.number} → ${client.email}`,
        clientId: saved.client_id,
        userId: user?.id,
      });
      setNotice(t("billing.sent", { email: client.email }));
      setEditorOpen(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("billing.sendFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function approveAndConvert(quote: BillingDocument) {
    setBusyId(quote.id);
    const invoice = await convertQuoteToInvoice(quote, docs);
    await logActivity({
      action: "converted quote",
      details: `${quote.number} → ${invoice.number}`,
      clientId: quote.client_id,
      userId: user?.id,
    });
    setBusyId(null);
    await load();
  }

  function openCompose(doc: BillingDocument) {
    if (!smtp || !company || !templates) {
      setNotice(t("billing.smtpMissing"));
      return;
    }
    const client = allClients.find((c) => c.id === doc.client_id);
    const project = allProjects.find((p) => p.id === doc.project_id);
    const filled = applyEmailTemplate(templates[templateKeyForKind(doc.kind)], {
      client: client?.company_name ?? "",
      kind: invoiceTitle(doc.kind, locale),
      number: doc.number,
      title: doc.title,
      amount: money(doc.amount, locale),
      company: company.legal_name,
      project: project?.name ?? "",
    });
    setCompose({
      doc,
      draft: {
        to: client?.email ? [client.email] : [],
        subject: filled.subject,
        body: filled.body,
      },
    });
  }

  async function sendComposed() {
    if (!compose || !smtp || !company) return;
    if (compose.draft.to.length === 0) {
      setNotice(t("mail.compose.needTo"));
      return;
    }
    const client = allClients.find((c) => c.id === compose.doc.client_id);
    if (!client) return;
    try {
      setBusyId(compose.doc.id);
      await sendInvoiceEmail({
        smtp,
        to: compose.draft.to,
        subject: compose.draft.subject.trim(),
        text: compose.draft.body,
        filename: `${compose.doc.kind}-${compose.doc.number}.pdf`,
        pdfBase64: invoicePdfBase64({
          doc: compose.doc,
          client,
          project: allProjects.find((p) => p.id === compose.doc.project_id) ?? null,
          company,
          locale,
        }),
      });
      await db
        .update(schema.billing_documents)
        .set({
          sent_at: todayISO(),
          sent_to: compose.draft.to.join(", "),
          status: compose.doc.status === "draft" ? "sent" : compose.doc.status,
        })
        .where(eq(schema.billing_documents.id, compose.doc.id));
      await logActivity({
        action: compose.doc.kind === "invoice" ? "sent invoice" : "sent quote",
        details: `${compose.doc.number} → ${compose.draft.to.join(", ")}`,
        clientId: compose.doc.client_id,
        userId: user?.id,
      });
      setNotice(t("billing.sent", { email: compose.draft.to.join(", ") }));
      setCompose(null);
      setEditorOpen(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("billing.sendFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function runQuickBooksExport() {
    setQbBusy(true);
    const counts = exportQuickBooksBundle({
      scope: qbScope,
      invoices,
      quotes,
      punches,
      clients: allClients,
      projects: allProjects,
      people,
    });
    if (qb) {
      const next = { ...qb, last_sync: todayISO() };
      setQb(next);
      const settings = await import("@/lib/settings");
      await settings.setSetting(settings.QUICKBOOKS_KEY, JSON.stringify(next));
    }
    const parts = [
      counts.invoices ? `${counts.invoices} ${t("qb.scope.invoices").toLowerCase()}` : "",
      counts.quotes ? `${counts.quotes} ${t("qb.scope.quotes").toLowerCase()}` : "",
      counts.hours ? `${counts.hours} ${t("qb.scope.hours").toLowerCase()}` : "",
    ].filter(Boolean);
    setNotice(t("qb.done", { summary: parts.join(" · ") || t("qb.scope.all") }));
    setQbBusy(false);
    setQbOpen(false);
  }

  function exportCsv(kind: BillingKind) {
    const rows = kind === "invoice" ? invoices : quotes;
    const header = ["Number", "Client", "Title", "Project", "Amount", "Status", "Issued", "Due"];
    const lines = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.number,
          `"${allClients.find((c) => c.id === row.client_id)?.company_name ?? ""}"`,
          `"${row.title.replace(/"/g, '""')}"`,
          `"${allProjects.find((p) => p.id === row.project_id)?.name ?? ""}"`,
          row.amount,
          row.status,
          row.issued_on ?? "",
          row.due_on ?? "",
        ].join(","),
      ),
    ];
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), `${kind}s.csv`);
  }

  function handlePdf(doc: BillingDocument) {
    if (!company) return;
    const client = allClients.find((c) => c.id === doc.client_id);
    if (!client) return;
    void downloadInvoicePdf({
      doc,
      client,
      project: allProjects.find((p) => p.id === doc.project_id) ?? null,
      company,
      locale,
    });
  }

  function handlePrint(doc: BillingDocument) {
    if (!company) return;
    const client = allClients.find((c) => c.id === doc.client_id);
    if (!client) return;
    printInvoice({
      doc,
      client,
      project: allProjects.find((p) => p.id === doc.project_id) ?? null,
      company,
      locale,
    });
  }

  if (user?.user_type === "external") {
    return <Navigate to={homeClientId ? `/clients/${homeClientId}/billing` : "/"} replace />;
  }
  if (loading || !company) return <PageSkeleton />;
  if (!canView) {
    return (
      <EmptyState
        icon={<Receipt className="size-5" />}
        title={t("billing.restricted")}
        description={t("billing.restrictedDesc")}
      />
    );
  }

  const outstanding = invoices.filter((d) => d.status !== "paid" && d.status !== "draft").reduce((sum, d) => sum + d.amount, 0);
  const paid = invoices.filter((d) => d.status === "paid").reduce((sum, d) => sum + d.amount, 0);
  const quoted = quotes.reduce((sum, d) => sum + d.amount, 0);
  const previewClient = preview ? allClients.find((c) => c.id === preview.client_id) : null;

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.accounting")}
        title={t("billing.accounting.title")}
        description={t("billing.accounting.desc")}
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setQbOpen(true)}>
                <Wallet className="size-4" />
                {t("qb.export")}
              </Button>
              <Button variant="outline" onClick={() => openCreate("quote")}>
                <Plus className="size-4" />
                {t("billing.newQuote")}
              </Button>
              <Button onClick={() => openCreate("invoice")}>
                <Plus className="size-4" />
                {t("billing.newInvoice")}
              </Button>
            </>
          ) : null
        }
      />

      {notice ? <p className="mb-4 text-sm text-muted-foreground">{notice}</p> : null}

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
          <DocTable
            kind="invoice"
            rows={invoices}
            clients={allClients}
            projects={allProjects}
            emptyTitle={t("billing.empty.invoices")}
            emptyDesc={t("billing.empty.invoicesStaff")}
            canManage={canManage}
            onCreate={() => openCreate("invoice")}
            onExport={() => exportCsv("invoice")}
            onOpen={setPreview}
            onPdf={handlePdf}
            onSend={canManage ? openCompose : undefined}
            busyId={busyId}
          />
        </TabsContent>
        <TabsContent value="quotes">
          <DocTable
            kind="quote"
            rows={quotes}
            clients={allClients}
            projects={allProjects}
            emptyTitle={t("billing.empty.quotes")}
            emptyDesc={t("billing.empty.quotesStaff")}
            canManage={canManage}
            onCreate={() => openCreate("quote")}
            onExport={() => exportCsv("quote")}
            onConvert={canManage ? approveAndConvert : undefined}
            busyId={busyId}
            onOpen={setPreview}
            onPdf={handlePdf}
            onSend={canManage ? openCompose : undefined}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t("billing.edit")
                : form.kind === "invoice"
                  ? t("billing.newInvoice")
                  : t("billing.newQuote")}
            </DialogTitle>
          </DialogHeader>
          <BillingEditor
            form={form}
            setForm={setForm}
            clients={allClients}
            projects={allProjects}
            saving={saving}
            canSend={canManage}
            smtpReady={mailReady}
            onCancel={() => setEditorOpen(false)}
            onSaveDraft={() => void onSaveDraft()}
            onSend={() => void onSend()}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview ? `${invoiceTitle(preview.kind, locale)} ${preview.number}` : t("billing.preview")}</DialogTitle>
          </DialogHeader>
          {preview && previewClient ? (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-end gap-2">
                {canManage && preview.kind === "quote" && preview.status === "accepted" ? (
                  <Button
                    size="sm"
                    disabled={busyId === preview.id}
                    onClick={() => void approveAndConvert(preview)}
                  >
                    <ArrowRight className="size-3.5" />
                    {t("billing.convert")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button variant="outline" size="sm" onClick={() => openEdit(preview)}>
                    <Pencil className="size-3.5" />
                    {t("billing.edit")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === preview.id}
                    title={mailReady ? t("billing.sendClient") : t("billing.smtpMissing")}
                    onClick={() => openCompose(preview)}
                  >
                    <Mail className="size-3.5" />
                    {t("billing.sendClient")}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => handlePrint(preview)}>
                  <Printer className="size-3.5" />
                  {t("billing.exportPdf")}
                </Button>
                <Button size="sm" onClick={() => handlePdf(preview)}>
                  <Download className="size-3.5" />
                  PDF
                </Button>
              </div>
              <InvoicePreview
                doc={preview}
                client={previewClient}
                project={allProjects.find((p) => p.id === preview.project_id) ?? null}
                company={company}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ComposeEmailDialog
        open={Boolean(compose)}
        draft={compose?.draft ?? null}
        sending={Boolean(compose && busyId === compose.doc.id)}
        onCancel={() => setCompose(null)}
        onChange={(draft) => setCompose((current) => (current ? { ...current, draft } : current))}
        onSend={() => void sendComposed()}
      />

      <Dialog open={qbOpen} onOpenChange={setQbOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("qb.title")}</DialogTitle>
            <DialogDescription>{t("qb.hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {qb?.connected ? t("qb.connected", { id: qb.realm_id }) : t("qb.notConnected")}
            </p>
            <div className="grid gap-2">
              {(
                [
                  ["all", invoices.length + quotes.length + punches.length],
                  ["invoices", invoices.length],
                  ["quotes", quotes.length],
                  ["hours", punches.length],
                ] as const
              ).map(([scope, count]) => (
                <label key={scope} className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Checkbox checked={qbScope === scope} onCheckedChange={() => setQbScope(scope)} />
                    <span className="text-sm">{t(`qb.scope.${scope}`)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{t("qb.count", { n: count })}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" asChild>
              <Link to="/settings?tab=quickbooks">{t("qb.openSettings")}</Link>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setQbOpen(false)}>
                {t("qb.cancel")}
              </Button>
              <Button disabled={qbBusy} onClick={() => void runQuickBooksExport()}>
                <Wallet className="size-4" />
                {qbBusy ? t("qb.running") : t("qb.run")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function DocTable({
  kind,
  rows,
  clients,
  projects,
  emptyTitle,
  emptyDesc,
  canManage,
  onCreate,
  onExport,
  onConvert,
  busyId,
  onOpen,
  onPdf,
  onSend,
}: {
  kind: BillingKind;
  rows: BillingDocument[];
  clients: Client[];
  projects: Project[];
  emptyTitle: string;
  emptyDesc: string;
  canManage: boolean;
  onCreate: () => void;
  onExport: () => void;
  onConvert?: (row: BillingDocument) => void;
  busyId?: number | null;
  onOpen: (row: BillingDocument) => void;
  onPdf: (row: BillingDocument) => void;
  onSend?: (row: BillingDocument) => void;
}) {
  const { t, locale } = useI18n();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={kind === "invoice" ? <Receipt className="size-5" /> : <FileText className="size-5" />}
        title={emptyTitle}
        description={emptyDesc}
        action={
          canManage ? (
            <Button onClick={onCreate}>
              <Plus className="size-4" />
              {kind === "invoice" ? t("billing.newInvoice") : t("billing.newQuote")}
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="size-3.5" />
          {t("billing.export")}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("billing.number")}</th>
              <th className="px-4 py-3 font-medium">{t("billing.client")}</th>
              <th className="px-4 py-3 font-medium">{t("billing.docTitle")}</th>
              <th className="px-4 py-3 font-medium">{t("billing.project")}</th>
              <th className="px-4 py-3 font-medium">{t("billing.issued")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("billing.amount")}</th>
              <th className="px-4 py-3 font-medium">{t("billing.status")}</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const convertible = row.status === "accepted";
              return (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => onOpen(row)}
                >
                  <td className="px-4 py-3 font-medium tabular-nums">{row.number}</td>
                  <td className="px-4 py-3">{clients.find((c) => c.id === row.client_id)?.company_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.title}</p>
                    {row.description ? <p className="text-xs text-muted-foreground">{row.description}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {projects.find((p) => p.id === row.project_id)?.name ?? t("billing.noProject")}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(row.issued_on, locale)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{money(row.amount, locale)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {kind === "quote" && onConvert && row.status === "converted" ? (
                        <span className="self-center text-xs text-muted-foreground">{t("billing.converted")}</span>
                      ) : null}
                      {kind === "quote" && row.status === "accepted" && row.signed_by ? (
                        <span className="self-center text-xs text-muted-foreground">
                          {t("billing.signedHint", { name: row.signed_by })}
                        </span>
                      ) : null}
                      {kind === "quote" && onConvert && convertible ? (
                        <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => onConvert(row)}>
                          <ArrowRight className="size-3.5" />
                          {t("billing.convert")}
                        </Button>
                      ) : null}
                      {onSend ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.id}
                          title={t("billing.sendClient")}
                          onClick={() => onSend(row)}
                        >
                          <Mail className="size-3.5" />
                          <span className="sr-only">{t("billing.sendClient")}</span>
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => onPdf(row)}>
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
    </div>
  );
}
