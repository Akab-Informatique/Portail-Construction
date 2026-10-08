import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Stamp,
  Eye,
  FileText,
  FileUp,
  Pencil,
  Receipt,
  Sparkles,
  Trash2,
} from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { quoteRows } from "@/lib/billing-tree";
import {
  BILLING_FILES_EVENT,
  addonsOf,
  chainOf,
  currentRevision,
  deleteBillingFile,
  finalVersion,
  displayStatus,
  listBillingFiles,
  listBillingRequests,
  markBillingSeen,
  quoteEffectiveTotal,
  revisionStatus,
  rootOf,
  saveFileDetails,
  setFileStatus,
  setFinalVersion,
  versionsOf,
} from "@/lib/billing-files";
import { formatDate, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BillingFileDialog, StatusPill } from "@/components/BillingFileDialog";
import { BillingUploadDialog, type UploadTarget } from "@/components/BillingUploadDialog";
import type { BillingFile, BillingRequest, Client, Project } from "@/lib/types";

const ALL = "all";

/**
 * "Gestion de la facturation": invoices and quotes are uploaded as files, read by the AI, confirmed by staff and
 * then shown (consultation only) in the client's own billing section.
 */
export function FinanceBillingPage() {
  const { user, permissions, can } = useAuth();
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<BillingFile[]>([]);
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState("invoices");
  const [clientFilter, setClientFilter] = useState(ALL);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);
  const [viewing, setViewing] = useState<BillingFile | null>(null);
  const [editing, setEditing] = useState<BillingFile | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Quote / final-version rows whose children are folded away. */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const groupBilling = permissions.some((p) => p.module === "billing" && Number(p.can_view) === 1);
  const canView = Boolean(user?.is_admin || groupBilling);
  const canManage = Boolean(user?.is_admin || (groupBilling && user?.user_type === "internal" && can("billing", "create")));

  const load = useCallback(async () => {
    try {
      await dbReady;
      const [fileRows, requestRows, clientRows, projectRows] = await Promise.all([
        listBillingFiles(),
        listBillingRequests(),
        db.select().from(schema.clients),
        db.select().from(schema.projects),
      ]);
      setFiles(fileRows);
      setRequests(requestRows);
      setClients((clientRows as Client[]).sort((a, b) => a.company_name.localeCompare(b.company_name)));
      setProjects(projectRows as Project[]);
    } catch (err) {
      console.error("finance billing load failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(BILLING_FILES_EVENT, onChange);
    return () => window.removeEventListener(BILLING_FILES_EVENT, onChange);
  }, [load]);

  // Opened from the notification bubble: /finance/billing?file=<id>
  useEffect(() => {
    const wanted = Number(params.get("file"));
    if (!wanted || files.length === 0) return;
    const found = files.find((f) => f.id === wanted);
    if (found) {
      setTab(found.kind === "quote" ? "quotes" : "invoices");
      setViewing(found);
      const chain = chainOf(found, files);
      const reqIds = requests.filter((r) => chain.some((c) => c.id === r.file_id) && r.staff_seen === 0).map((r) => r.id);
      const fileIds = chain.filter((f) => f.staff_seen === 0).map((f) => f.id);
      void markBillingSeen({ requestIds: reqIds, fileIds });
    }
    setParams({}, { replace: true });
  }, [files, requests, params, setParams]);

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.company_name])), [clients]);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const inScope = useCallback((f: BillingFile) => clientFilter === ALL || String(f.client_id) === clientFilter, [clientFilter]);
  const roots = files.filter((f) => !f.parent_id && inScope(f));
  const invoices = roots.filter((f) => f.kind === "invoice");
  const quotes = roots.filter((f) => f.kind === "quote");

  const published = (f: BillingFile) => f.published === 1;
  const invoicedTotal = invoices.filter(published).reduce((s, f) => s + f.amount, 0);
  const outstanding = invoices.filter(published).filter((f) => displayStatus(f) !== "paid").reduce((s, f) => s + f.amount, 0);
  const overdueTotal = invoices.filter(published).filter((f) => displayStatus(f) === "overdue").reduce((s, f) => s + f.amount, 0);
  // Each quote counts once, at the amount of the version in force (never a sum of versions).
  const liveQuotes = quotes.filter(published).filter((q) => revisionStatus(currentRevision(q, files), files) !== "rejected");
  // Version in force + accepted add-ons.
  const quotesTotal = liveQuotes.reduce((sum, q) => sum + quoteEffectiveTotal(q, files), 0);

  // Add-ons on the quotes above: the accepted ones are inside the quote total; they also get their own box.
  const addonsOfLive = liveQuotes.flatMap((q) => addonsOf(q, files)).filter(published);
  const acceptedAddons = addonsOfLive.filter((a) => a.status === "accepted");
  const pendingAddons = addonsOfLive.filter((a) => a.status === "sent");
  const addonsTotal = acceptedAddons.reduce((sum, a) => sum + a.amount, 0);
  const quotesBase = quotesTotal - addonsTotal;

  /** How many distinct projects a set of documents belongs to (an add-on belongs to its quote's project). */
  const projectCount = (docs: BillingFile[]) =>
    new Set(docs.map((d) => d.project_id ?? rootOf(d, files).project_id).filter((id): id is number => id !== null)).size;
  const projectsInvoiced = projectCount(invoices.filter(published));
  const projectsOutstanding = projectCount(invoices.filter(published).filter((f) => displayStatus(f) !== "paid"));
  const projectsQuotes = projectCount(liveQuotes);
  const projectsAddons = projectCount(acceptedAddons);
  const openRequests = requests.filter((r) => r.status === "open" && (clientFilter === ALL || String(r.client_id) === clientFilter)).length;

  if (user?.user_type === "external") return <Navigate to="/" replace />;
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

  async function remove(file: BillingFile) {
    if (!window.confirm(t("billing.delete.confirm", { number: file.number || String(file.id) }))) return;
    setBusyId(file.id);
    try {
      await deleteBillingFile(file);
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(file: BillingFile) {
    setBusyId(file.id);
    try {
      await setFileStatus(file, "paid");
    } finally {
      setBusyId(null);
    }
  }

  const toggleFold = (id: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openUpload = (kind: "invoice" | "quote") => setUploadTarget({ kind });
  const openAnnex = (quote: BillingFile, addon = false) =>
    setUploadTarget({
      kind: "quote",
      parent: quote,
      addon,
      nextVersion: addon ? addonsOf(quote, files).length + 1 : versionsOf(quote, files).length,
      requests: requests.filter((r) => chainOf(quote, files).some((c) => c.id === r.file_id)),
    });

  /** One row per document. A quote and its newer versions are listed together, oldest first. */
  function renderRow(file: BillingFile, level: number, hasChildren: boolean) {
    const isVersion = level > 0;
    const isQuote = file.kind === "quote";
    const chain = isQuote ? chainOf(file, files) : [];
    const current = isQuote ? currentRevision(file, files) : null;
    const status = revisionStatus(file, files);
    const isVoid = status === "void";
    const isAddon = file.is_addon === 1;
    const finalExists = isQuote ? Boolean(finalVersion(file, files)) : false;
    const reqs = isQuote && !isVersion ? requests.filter((r) => chain.some((c) => c.id === r.file_id)) : [];
    const open = reqs.filter((r) => r.status === "open");
    const unseen = file.staff_seen === 0 || reqs.some((r) => r.staff_seen === 0);
    const muted = isVoid ? "text-muted-foreground" : "";

    return (
      <tr key={file.id} className={isVersion ? "bg-muted/20" : "hover:bg-muted/30"}>
        <td className={`whitespace-nowrap py-3 pr-3 font-medium tabular-nums ${muted}`} style={{ paddingLeft: 12 + level * 22 }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFold(file.id);
              }}
              aria-expanded={!collapsed.has(file.id)}
              aria-label={t("billing.mods.toggle")}
              className="mr-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {collapsed.has(file.id) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          ) : (
            <span className="mr-1.5 inline-block size-5 align-middle" aria-hidden />
          )}
          <span className={isVoid ? "line-through" : ""}>
            {isAddon ? "+ " : ""}
            {file.number || `#${file.id}`}
          </span>
          {unseen ? <span className="ml-2 inline-block size-2 rounded-full bg-primary align-middle" title={t("billing.new")} /> : null}
        </td>
        <td className={`px-3 py-3 ${muted}`}>
          <p className="font-medium">{file.title || "—"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {isQuote && !isAddon && current && chain.length > 1 && file.id === current.id ? (
              <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-foreground">{t("billing.version.current")}</span>
            ) : null}
            {isAddon ? <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-foreground">{t("billing.addon.badge")}</span> : null}
            {file.published !== 1 ? <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-amber-800 dark:text-amber-300">{t("billing.draft")}</span> : null}
            {file.ai_status === "analyzed" ? (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3" />
                {t("billing.ai.read")}
              </span>
            ) : null}
            {open.length > 0 ? (
              <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-foreground">
                {t("billing.requests.count", { n: open.length })}
              </span>
            ) : null}
          </p>
        </td>
        <td className="px-3 py-3 text-muted-foreground">{clientName.get(file.client_id) ?? "—"}</td>
        <td className="px-3 py-3 text-muted-foreground">{file.project_id ? projectName.get(file.project_id) ?? "—" : "—"}</td>
        <td className="px-3 py-3 tabular-nums text-muted-foreground">{formatDate(file.issued_on, locale)}</td>
        <td className="px-3 py-3 tabular-nums text-muted-foreground">{file.kind === "invoice" ? formatDate(file.due_on, locale) : "—"}</td>
        <td className={`px-3 py-3 text-right font-medium tabular-nums ${muted}`}>
          <span className={isVoid ? "line-through" : ""}>
            {isAddon ? "+ " : ""}
            {money(file.amount, locale)}
          </span>
        </td>
        <td className="px-3 py-3">
          <StatusPill file={file} mode="staff" status={status} />
        </td>
        <td className="px-3 py-3">
          <div className="ml-auto flex max-w-[19rem] flex-wrap justify-end gap-1.5">
            {isQuote && !isVersion && canManage ? (
              <Button size="sm" variant={open.length > 0 ? "default" : "outline"} onClick={() => openAnnex(file, finalExists)}>
                <FileUp className="size-3.5" />
                {finalExists ? t("billing.addon.upload") : t("billing.addDocument")}
              </Button>
            ) : null}
            {isQuote && !isAddon && canManage && status === "accepted" && !finalExists ? (
              <Button
                size="icon-sm"
                variant="outline"
                title={t("billing.final.mark")}
                onClick={() => {
                  if (window.confirm(t("billing.final.confirm", { number: file.number || String(file.id) }))) void setFinalVersion(file, files, true);
                }}
              >
                <Stamp className="size-3.5" />
              </Button>
            ) : null}
            <Button size="icon-sm" variant="outline" title={t("billing.file.view")} onClick={() => setViewing(file)}>
              <Eye className="size-3.5" />
            </Button>
            {canManage ? (
              <>
                {file.kind === "invoice" && file.status !== "paid" && file.published === 1 ? (
                  <Button size="icon-sm" variant="outline" title={t("billing.markPaid")} disabled={busyId === file.id} onClick={() => void markPaid(file)}>
                    <BadgeCheck className="size-3.5" />
                  </Button>
                ) : null}
                <Button size="icon-sm" variant="outline" title={t("billing.edit")} onClick={() => setEditing(file)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="icon-sm" variant="outline" title={t("billing.delete")} disabled={busyId === file.id} onClick={() => void remove(file)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  function table(kind: "invoice" | "quote", rows: BillingFile[]) {
    if (rows.length === 0) {
      return (
        <EmptyState
          icon={kind === "invoice" ? <Receipt className="size-5" /> : <FileText className="size-5" />}
          title={kind === "invoice" ? t("billing.empty.invoices") : t("billing.empty.quotes")}
          description={t("billing.mgmt.emptyDesc")}
          action={
            canManage ? (
              <Button onClick={() => openUpload(kind)}>
                <FileUp className="size-4" />
                {kind === "invoice" ? t("billing.upload.invoiceButton") : t("billing.upload.quoteButton")}
              </Button>
            ) : undefined
          }
        />
      );
    }
    return (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">{t("billing.number")}</th>
              <th className="px-3 py-3 font-medium">{t("billing.docTitle")}</th>
              <th className="px-3 py-3 font-medium">{t("billing.client")}</th>
              <th className="px-3 py-3 font-medium">{t("billing.project")}</th>
              <th className="px-3 py-3 font-medium">{t("billing.issued")}</th>
              <th className="px-3 py-3 font-medium">{t("billing.due")}</th>
              <th className="px-3 py-3 text-right font-medium">{t("billing.amount")}</th>
              <th className="px-3 py-3 font-medium">{t("billing.status")}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.flatMap((row) =>
              kind === "quote"
                ? quoteRows(row, files, collapsed).map((tr) => renderRow(tr.file, tr.level, tr.hasChildren))
                : [renderRow(row, 0, false)],
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.section.finance")}
        title={t("billing.mgmt.title")}
        description={t("billing.mgmt.desc")}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openUpload("quote")}>
                <FileUp className="size-4" />
                {t("billing.upload.quoteButton")}
              </Button>
              <Button onClick={() => openUpload("invoice")}>
                <FileUp className="size-4" />
                {t("billing.upload.invoiceButton")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary
          label={t("billing.stat.invoiced")}
          value={money(invoicedTotal, locale)}
          hint={t("billing.stat.invoiceCount", { n: invoices.filter(published).length })}
          projects={projectsInvoiced}
        />
        <Summary
          label={t("billing.stat.outstanding")}
          value={money(outstanding, locale)}
          hint={overdueTotal > 0 ? t("billing.stat.overdueHint", { amount: money(overdueTotal, locale) }) : t("billing.stat.noneOverdue")}
          tone={overdueTotal > 0 ? "alert" : undefined}
          projects={projectsOutstanding}
        />
        <Summary
          label={t("billing.stat.quotesAndAddons")}
          value={money(quotesTotal, locale)}
          hint={t("billing.stat.quotesBreakdown", { base: money(quotesBase, locale), addons: money(addonsTotal, locale) })}
          projects={projectsQuotes}
        />
        <Summary
          label={t("billing.stat.addons")}
          value={money(addonsTotal, locale)}
          hint={t("billing.stat.addonsHint", { n: acceptedAddons.length, p: pendingAddons.length })}
          projects={projectsAddons}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-xs">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("billing.allClients")}</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.company_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {openRequests > 0 ? (
          <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm">{t("billing.requests.banner", { n: openRequests })}</p>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-5">
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
        <TabsContent value="invoices">{table("invoice", invoices)}</TabsContent>
        <TabsContent value="quotes">{table("quote", quotes)}</TabsContent>
      </Tabs>

      <BillingUploadDialog
        target={uploadTarget}
        clients={clients}
        projects={projects}
        userId={user?.id ?? 0}
        onClose={() => setUploadTarget(null)}
        onDone={() => {
          setUploadTarget(null);
          void load();
        }}
      />

      <BillingFileDialog
        file={viewing}
        allFiles={files}
        requests={requests}
        mode="staff"
        canDecide={false}
        canManage={canManage}
        userId={user?.id ?? 0}
        userName={user?.name ?? ""}
        companyName="FRX Construction"
        onClose={() => setViewing(null)}
        onChanged={() => void load()}
        onAddDocument={(quote, addon) => {
          setViewing(null);
          openAnnex(quote, addon);
        }}
      />

      <EditDialog
        file={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </div>
  );
}

function Summary({
  label,
  value,
  hint,
  tone,
  projects,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "alert";
  /** Number of projects this figure is spread over (shown bottom right). */
  projects: number;
}) {
  const { t } = useI18n();
  return (
    <Card className="gap-1 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl font-semibold tabular-nums tracking-tight ${tone === "alert" ? "text-rose-600 dark:text-rose-400" : ""}`}>{value}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <p className="shrink-0 whitespace-nowrap text-right text-xs font-medium text-muted-foreground">{t("billing.stat.projects", { n: projects })}</p>
      </div>
    </Card>
  );
}

/** Correct the figures of a document that is already saved. */
function EditDialog({ file, onClose, onSaved }: { file: BillingFile | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>({});
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setForm({
      number: file.number ?? "",
      title: file.title ?? "",
      issued_on: file.issued_on ?? "",
      due_on: file.due_on ?? "",
      subtotal: file.subtotal === null ? "" : String(file.subtotal),
      tax_gst: file.tax_gst === null ? "" : String(file.tax_gst),
      tax_qst: file.tax_qst === null ? "" : String(file.tax_qst),
      amount: String(file.amount),
      status: file.status,
    });
    setPublish(file.published === 1);
    setError(null);
  }, [file]);

  if (!file) return null;
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  async function save() {
    if (!file) return;
    const amount = num(form.amount ?? "");
    if (amount === null || amount <= 0) {
      setError(t("billing.review.needTotal"));
      return;
    }
    setBusy(true);
    try {
      await saveFileDetails(
        file,
        {
          number: (form.number ?? "").trim(),
          title: (form.title ?? "").trim(),
          description: file.description,
          subtotal: num(form.subtotal ?? ""),
          tax_gst: num(form.tax_gst ?? ""),
          tax_qst: num(form.tax_qst ?? ""),
          amount,
          issued_on: form.issued_on || null,
          due_on: form.due_on || null,
          status: form.status || file.status,
          project_id: file.project_id,
        },
        publish,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("billing.upload.failed"));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: string, label: string, type = "text") => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} step={type === "number" ? "0.01" : undefined} value={form[key] ?? ""} onChange={set(key)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("billing.edit")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("number", t("billing.number"))}
          {field("title", t("billing.docTitle"))}
          {field("issued_on", t("billing.issued"), "date")}
          {file.kind === "invoice" ? field("due_on", t("billing.due"), "date") : <div />}
          {field("subtotal", t("invoice.subtotal"), "number")}
          {field("tax_gst", t("invoice.gst"), "number")}
          {field("tax_qst", t("invoice.qst"), "number")}
          {field("amount", t("invoice.total"), "number")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("billing.status")}</Label>
            <Select value={form.status ?? file.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(file.kind === "invoice" ? ["sent", "paid"] : ["sent", "accepted", "rejected"]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}` as "status.sent")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          {t("billing.edit.visible")}
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {t("settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
