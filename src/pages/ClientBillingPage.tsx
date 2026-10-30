import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, ChevronRight, FilePlus2, ReceiptText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { formatDate, moneyExact } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import {
  BILLING_FILES_EVENT,
  currentRevision,
  displayStatus,
  isPendingDecision,
  listBillingFiles,
  listBillingRequests,
  quoteEffectiveTotal,
  revisionStatus,
} from "@/lib/billing-files";
import type { BillingFile, BillingRequest, Project } from "@/lib/types";
import { BillingFileDialog, StatusPill } from "@/components/BillingFileDialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/Skeleton";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

/**
 * A client account's invoices and quotes, all projects together in two tabs. It works like the project's own page: open a
 * line to read it as a PDF, print it, accept or decline a quote, ask for a change. Each line says which project it is for
 * and whether an invoice is past its due date.
 */
export function ClientBillingPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { projects, clientProjects, selectedClient, clients } = useWorkspace();
  const isClient = user?.user_type === "external" || user?.view_as === "client";
  const jobs: Project[] = selectedClient ? clientProjects : projects;
  const [files, setFiles] = useState<BillingFile[] | null>(null);
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [tab, setTab] = useState<"invoices" | "quotes">("invoices");
  const [projectId, setProjectId] = useState("all");
  const [viewingId, setViewingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [f, r] = await Promise.all([listBillingFiles(), listBillingRequests()]);
    setFiles(f);
    setRequests(r);
  }, []);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(BILLING_FILES_EVENT, on);
    return () => window.removeEventListener(BILLING_FILES_EVENT, on);
  }, [load]);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  // Only what was sent to this client, on the projects they belong to.
  const mine = useMemo(
    () => (files ?? []).filter((f) => f.kind !== "supplier" && f.published === 1 && f.project_id !== null && jobById.has(f.project_id) && (projectId === "all" || String(f.project_id) === projectId)),
    [files, jobById, projectId],
  );
  const invoices = mine.filter((f) => f.kind === "invoice").sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? ""));
  const quotes = mine.filter((f) => f.kind === "quote" && !f.parent_id).sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? ""));

  if (!isClient) return <Navigate to="/" replace />;
  if (files === null) return <PageSkeleton />;

  const today = new Date().toISOString().slice(0, 10);
  const late = invoices.filter((inv) => displayStatus(inv) === "overdue").sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""));
  const daysLate = (due: string) => Math.max(1, Math.round((Date.parse(today) - Date.parse(due)) / DAY));
  const waiting = quotes.filter((q) => isPendingDecision(currentRevision(q, mine), mine)).length;
  const viewing = files.find((f) => f.id === viewingId) ?? null;
  const company = clients[0]?.company_name ?? selectedClient?.company_name ?? "";

  const chip = (projectIdOf: number | null) => {
    const job = projectIdOf === null ? undefined : jobById.get(projectIdOf);
    if (!job) return null;
    return (
      <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium">
        <span className="size-2 shrink-0 rounded-full" style={{ background: projectColor(job) }} />
        <span className="truncate">
          {job.project_number} · {job.name}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("nav.section.accounting")} title={t("nav.clientBilling")} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {(
            [
              ["invoices", t("pb.invoices"), ReceiptText, invoices.length, late.length],
              ["quotes", t("pb.quotes"), FilePlus2, quotes.length, waiting],
            ] as const
          ).map(([id, label, Icon, n, alert]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon className="size-4" />
              {label}
              <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
              {alert > 0 ? <span className="rounded-full bg-rose-500 px-1.5 py-px text-[10px] font-semibold text-white">{alert}</span> : null}
            </button>
          ))}
        </div>
        {jobs.length > 1 ? (
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("cb.allProjects")}</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={String(j.id)}>
                  {j.project_number} · {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {tab === "invoices" ? (
        <>
          {late.length > 0 ? (
            <Card className="gap-2 border-rose-500/40 bg-rose-500/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-300">
                <AlertTriangle className="size-4" />
                {t("pb.overdue", { n: late.length })}
              </p>
              <ul className="space-y-1">
                {late.map((inv) => (
                  <li key={inv.id}>
                    <button type="button" className="flex w-full flex-wrap items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-rose-500/10" onClick={() => setViewingId(inv.id)}>
                      <span className="font-semibold tabular-nums">{inv.number}</span>
                      {chip(inv.project_id)}
                      <span className="min-w-0 flex-1 truncate text-xs text-rose-800 dark:text-rose-300">
                        {t("pb.dueOn", { date: formatDate(inv.due_on ?? "", locale) })} · {t("pb.daysLate", { n: daysLate(inv.due_on ?? today) })}
                      </span>
                      <span className="font-semibold tabular-nums">{moneyExact(inv.amount, locale)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {invoices.length === 0 ? (
            <EmptyState icon={<ReceiptText className="size-5" />} title={t("cb.noInvoices")} description="" />
          ) : (
            <Card className="gap-0 overflow-hidden p-0">
              <ul className="divide-y">
                {invoices.map((inv) => {
                  const status = displayStatus(inv);
                  const isLate = status === "overdue";
                  return (
                    <li key={inv.id} className={cn(isLate && "bg-rose-500/5")}>
                      <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setViewingId(inv.id)}>
                        <span className="font-semibold tabular-nums">{inv.number}</span>
                        <span className="min-w-0 flex-1 truncate">{inv.title}</span>
                        {chip(inv.project_id)}
                        <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
                          {inv.issued_on ? formatDate(inv.issued_on, locale) : ""}
                          {inv.due_on ? ` · ${t("pb.dueOn", { date: formatDate(inv.due_on, locale) })}` : ""}
                        </span>
                        {isLate && inv.due_on ? <span className="text-xs font-medium text-rose-700 dark:text-rose-300">{t("pb.daysLate", { n: daysLate(inv.due_on) })}</span> : null}
                        <StatusPill file={inv} mode="client" status={status} />
                        <span className="w-28 text-right font-semibold tabular-nums">{moneyExact(inv.amount, locale)}</span>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      ) : quotes.length === 0 ? (
        <EmptyState icon={<FilePlus2 className="size-5" />} title={t("cb.noQuotes")} description="" />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <ul className="divide-y">
            {quotes.map((q) => {
              const current = currentRevision(q, mine);
              const pending = isPendingDecision(current, mine);
              return (
                <li key={q.id} className={cn(pending && "bg-amber-500/5")}>
                  <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setViewingId(q.id)}>
                    <span className="font-semibold tabular-nums">{q.number}</span>
                    <span className="min-w-0 flex-1 truncate">{q.title}</span>
                    {chip(q.project_id)}
                    <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">{q.issued_on ? formatDate(q.issued_on, locale) : ""}</span>
                    {pending ? <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("cb.waiting")}</span> : null}
                    <StatusPill file={current} mode="client" status={revisionStatus(current, mine)} />
                    <span className="w-28 text-right font-semibold tabular-nums">{moneyExact(quoteEffectiveTotal(q, mine), locale)}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <BillingFileDialog
        file={viewing}
        allFiles={files}
        requests={requests}
        mode="client"
        canDecide
        canManage={false}
        userId={user?.id ?? 0}
        userName={user?.name ?? ""}
        companyName={company}
        onClose={() => setViewingId(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}
