import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { Eye, FileText, Receipt } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import {
  BILLING_FILES_EVENT,
  displayStatus,
  listPublishedForClient,
  listRequestsForClient,
  quoteEffectiveTotal,
} from "@/lib/billing-files";
import { formatDate, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { BillingFileDialog, StatusPill } from "@/components/BillingFileDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BillingFile, BillingRequest, Client, Project } from "@/lib/types";

/**
 * What a client sees: the invoices and quotes FRX uploaded and published for them (consultation only).
 * Open a quote to accept it, ask for a modification (demande de changement) or approve an annex.
 */
export function ClientBillingPage() {
  const { clientId } = useParams();
  const id = Number(clientId);
  const { user, can } = useAuth();
  const { clients } = useWorkspace();
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<BillingFile[]>([]);
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [viewing, setViewing] = useState<BillingFile | null>(null);
  const [tab, setTab] = useState("invoices");

  const isExternal = user?.user_type === "external";
  const clientView = isExternal || user?.view_as === "client";
  const canView = Boolean(user?.is_admin || can("billing", "view") || isExternal);

  const load = useCallback(async () => {
    // Always leave the loading state, even if a query fails, so the page never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
      if (!rows[0]) {
        setClient(null);
        return;
      }
      const [jobs, docs, reqs] = await Promise.all([
        db.select().from(schema.projects).where(eq(schema.projects.client_id, id)),
        listPublishedForClient(id),
        listRequestsForClient(id),
      ]);
      setClient(rows[0] as Client);
      setProjects(jobs as Project[]);
      setFiles(docs);
      setRequests(reqs);
    } catch (err) {
      console.error("ClientBillingPage load failed", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(BILLING_FILES_EVENT, onChange);
    return () => window.removeEventListener(BILLING_FILES_EVENT, onChange);
  }, [load]);

  // Opened from the notification bubble: /clients/<id>/billing?file=<id>
  useEffect(() => {
    const wanted = Number(params.get("file"));
    if (!wanted || files.length === 0) return;
    const found = files.find((f) => f.id === wanted);
    if (found) {
      const root = found.parent_id ? files.find((f) => f.id === found.parent_id) ?? found : found;
      setTab(root.kind === "quote" ? "quotes" : "invoices");
      setViewing(root);
    }
    setParams({}, { replace: true });
  }, [files, params, setParams]);

  const roots = useMemo(() => files.filter((f) => !f.parent_id), [files]);
  const invoices = roots.filter((f) => f.kind === "invoice");
  const quotes = roots.filter((f) => f.kind === "quote");
  const workspaceClient = clients.find((c) => c.id === id) ?? client;

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
  if (!workspaceClient) {
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

  const outstanding = invoices.filter((d) => displayStatus(d) !== "paid").reduce((sum, d) => sum + d.amount, 0);
  const paid = invoices.filter((d) => d.status === "paid").reduce((sum, d) => sum + d.amount, 0);
  const quoted = quotes.filter((q) => q.status !== "rejected").reduce((sum, q) => sum + quoteEffectiveTotal(q, files), 0);
  const waiting = files.filter((f) => f.kind === "quote" && f.status === "sent").length;

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
        <SummaryCard
          label={t("billing.stat.quotes")}
          value={money(quoted, locale)}
          hint={waiting > 0 && clientView ? t("billing.stat.toApprove", { n: waiting }) : t("billing.stat.quoteCount", { n: quotes.length })}
        />
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

        <TabsContent value="invoices">
          <FileList
            rows={invoices}
            all={files}
            projects={projects}
            requests={requests}
            kind="invoice"
            emptyTitle={t("billing.empty.invoices")}
            emptyDesc={t("billing.empty.invoicesDesc")}
            onOpen={setViewing}
          />
        </TabsContent>
        <TabsContent value="quotes">
          <FileList
            rows={quotes}
            all={files}
            projects={projects}
            requests={requests}
            kind="quote"
            emptyTitle={t("billing.empty.quotes")}
            emptyDesc={t("billing.empty.quotesDesc")}
            onOpen={setViewing}
          />
        </TabsContent>
      </Tabs>

      <BillingFileDialog
        file={viewing}
        allFiles={files}
        requests={requests}
        mode={clientView ? "client" : "staff"}
        canDecide={isExternal}
        canManage={false}
        userId={user?.id ?? 0}
        userName={user?.name ?? ""}
        companyName={workspaceClient.company_name}
        onClose={() => setViewing(null)}
        onChanged={() => void load()}
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

function FileList({
  rows,
  all,
  projects,
  requests,
  kind,
  emptyTitle,
  emptyDesc,
  onOpen,
}: {
  rows: BillingFile[];
  all: BillingFile[];
  projects: Project[];
  requests: BillingRequest[];
  kind: "invoice" | "quote";
  emptyTitle: string;
  emptyDesc: string;
  onOpen: (file: BillingFile) => void;
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
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("billing.number")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.docTitle")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.project")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.issued")}</th>
            {kind === "invoice" ? <th className="px-4 py-3 font-medium">{t("billing.due")}</th> : null}
            <th className="px-4 py-3 text-right font-medium">{t("billing.amount")}</th>
            <th className="px-4 py-3 font-medium">{t("billing.status")}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const pendingAnnexes = kind === "quote" ? all.filter((a) => a.parent_id === row.id && a.status === "sent").length : 0;
            const openRequests = kind === "quote" ? requests.filter((r) => r.file_id === row.id && r.status === "open").length : 0;
            const total = kind === "quote" ? quoteEffectiveTotal(row, all) : row.amount;
            return (
              <tr key={row.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onOpen(row)}>
                <td className="px-4 py-3 font-medium tabular-nums">{row.number || `#${row.id}`}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.title || "—"}</p>
                  <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {pendingAnnexes > 0 ? (
                      <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-foreground">{t("billing.annex.pendingCount", { n: pendingAnnexes })}</span>
                    ) : null}
                    {openRequests > 0 ? <span>{t("billing.requests.count", { n: openRequests })}</span> : null}
                  </p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{projects.find((p) => p.id === row.project_id)?.name ?? t("billing.noProject")}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(row.issued_on, locale)}</td>
                {kind === "invoice" ? <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(row.due_on, locale)}</td> : null}
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {money(total, locale)}
                  {kind === "quote" && total !== row.amount ? (
                    <p className="text-[11px] font-normal text-muted-foreground">{t("billing.quote.withAnnexes", { base: money(row.amount, locale) })}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <StatusPill file={row} mode="client" />
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" onClick={() => onOpen(row)}>
                    <Eye className="size-3.5" />
                    {t("billing.file.view")}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
