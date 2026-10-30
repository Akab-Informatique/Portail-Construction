import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, FilePlus2, MessageSquareWarning, ReceiptText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { canUseMenuModule } from "@/lib/app-modules";
import { formatDate, money, moneyExact } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import {
  BILLING_FILES_EVENT,
  addonsOf,
  chainOf,
  currentRevision,
  displayStatus,
  listBillingFiles,
  priceLabel,
  listBillingRequests,
  quoteEffectiveTotal,
  revisionStatus,
  versionsOf,
} from "@/lib/billing-files";
import { buildProjectMoney } from "@/lib/project-money";
import type { BillingFile, BillingRequest } from "@/lib/types";
import { BillingFileDialog, StatusPill } from "@/components/BillingFileDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

/**
 * Quotes and invoices of this project, the way the client sees them: every quote with its versions, add-ons and
 * change requests, then the invoices. Clicking any line opens it in Billing management to make adjustments.
 */
export function ProjectBilling({ project, client }: SectionProps) {
  const { t, locale } = useI18n();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const color = projectColor(project);
  const [files, setFiles] = useState<BillingFile[]>([]);
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  /** Quotes and invoices are two pages of the same section: one button to go from one to the other. */
  const [tab, setTab] = useState<"quotes" | "invoices">("quotes");
  // A client account never leaves this page: it opens, accepts, declines and asks for changes right here.
  const viewer = user?.user_type === "external" || user?.view_as === "client";
  const [viewingId, setViewingId] = useState<number | null>(null);
  const canManage = !viewer && canUseMenuModule(user, can, "app_billing_mgmt");

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

  // A client account only ever sees what was sent to it.
  const mine = useMemo(() => files.filter((f) => f.project_id === project.id && f.kind !== "supplier" && (!viewer || f.published === 1)), [files, project.id, viewer]);
  const quotes = mine.filter((f) => f.kind === "quote" && !f.parent_id);
  const invoices = mine.filter((f) => f.kind === "invoice").sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? ""));
  const moneyOf = buildProjectMoney(mine).get(project.id);
  const open = (id: number) => {
    if (!viewer) return navigate(`/finance/billing?file=${id}`);
    setViewingId(id);
  };
  const viewing = files.find((f) => f.id === viewingId) ?? null;
  const pillMode = viewer ? "client" : "staff";
  const openRequests = requests.filter((r) => r.status === "open" && mine.some((f) => f.id === r.file_id));

  // Invoices past their payment due date: the client is shown these, oldest first.
  const today = new Date().toISOString().slice(0, 10);
  const late = invoices.filter((inv) => displayStatus(inv) === "overdue").sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""));
  const daysLate = (due: string) => Math.max(1, Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000));

  const cards = [
    { label: t("pb.contract"), value: moneyOf?.contract ?? 0 },
    { label: t("pb.pending"), value: moneyOf?.pending ?? 0 },
    { label: t("pb.invoiced"), value: moneyOf?.invoiced ?? 0 },
    { label: t("pb.paid"), value: moneyOf?.paid ?? 0 },
    // What is left to collect is for FRX only.
    ...(viewer ? [] : [{ label: t("pb.toCollect"), value: moneyOf?.unpaid ?? 0 }]),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={cn("grid flex-1 gap-3 sm:grid-cols-3", viewer ? "xl:grid-cols-4" : "xl:grid-cols-5")}>
          {cards.map((c) => (
            <Card key={c.label} className="gap-1 px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{c.label}</p>
              <p className="font-display text-2xl leading-none tabular-nums">{money(c.value, locale)}</p>
            </Card>
          ))}
        </div>
        {canManage ? (
          <Button variant="outline" onClick={() => navigate("/finance/billing")}>
            <ReceiptText className="size-4" />
            {t("pb.openMgmt")}
          </Button>
        ) : null}
      </div>

      {viewer && late.length > 0 ? (
        <Card className="gap-2 border-rose-500/40 bg-rose-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-300">
            <AlertTriangle className="size-4" />
            {t("pb.overdue", { n: late.length })}
          </p>
          <ul className="space-y-1">
            {late.map((inv) => (
              <li key={inv.id}>
                <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-rose-500/10" onClick={() => open(inv.id)}>
                  <span className="font-semibold tabular-nums">{inv.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{inv.title}</span>
                  <span className="hidden text-xs text-rose-800 sm:inline dark:text-rose-300">
                    {t("pb.dueOn", { date: formatDate(inv.due_on ?? "", locale) })} · {t("pb.daysLate", { n: daysLate(inv.due_on ?? today) })}
                  </span>
                  <span className="ml-auto min-w-24 text-right sm:w-28 font-semibold tabular-nums">{moneyExact(inv.amount, locale)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {openRequests.length > 0 ? (
        <Card className="gap-2 border-amber-500/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareWarning className="size-4 text-amber-600" />
            {t("pb.requests", { n: openRequests.length })}
          </p>
          <ul className="space-y-1">
            {openRequests.map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/60" onClick={() => open(r.file_id)}>
                  <span className="font-medium">{r.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.title}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
        {(
          [
            ["quotes", t("pb.quotes"), FilePlus2, quotes.length, 0],
            ["invoices", t("pb.invoices"), ReceiptText, invoices.length, late.length],
          ] as const
        ).map(([id, label, Icon, n, alert]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", tab === id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            style={tab === id ? { background: `color-mix(in srgb, ${color} 18%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
          >
            <Icon className="size-4" style={tab === id ? { color } : undefined} />
            {label}
            <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
            {alert > 0 && viewer ? <span className="rounded-full bg-rose-500 px-1.5 py-px text-[10px] font-semibold text-white">{alert}</span> : null}
          </button>
        ))}
      </div>

      {/* quotes */}
      {tab === "quotes" ? (
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <FilePlus2 className="size-4" />
          {t("pb.quotes")}
          <span className="h-px flex-1 bg-border" aria-hidden />
        </h2>
        {quotes.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">{t("pb.noQuotes")}</Card>
        ) : (
          quotes.map((q) => {
            const current = currentRevision(q, mine);
            const status = revisionStatus(current, mine);
            const chain = chainOf(q, mine);
            const kids = chain.slice(1);
            const isFolded = folded.has(q.id);
            const addons = addonsOf(q, mine).length;
            return (
              <Card key={q.id} className="gap-0 overflow-hidden p-0" style={{ boxShadow: `var(--glass-shadow), inset 3px 0 0 ${color}` }}>
                <div className="flex items-center gap-3 px-4 py-3">
                  {kids.length ? (
                    <button
                      type="button"
                      aria-label={isFolded ? "+" : "−"}
                      className="rounded p-1 hover:bg-foreground/10"
                      onClick={() => setFolded((prev) => { const n = new Set(prev); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
                    >
                      <ChevronDown className={cn("size-4 transition-transform", isFolded && "-rotate-90")} />
                    </button>
                  ) : (
                    <span className="size-6" />
                  )}
                  <button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => open(q.id)}>
                    <span className="font-semibold tabular-nums">{q.number}</span>
                    <span className="min-w-0 flex-1 truncate">{q.title}</span>
                    {kids.length ? (
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {t("pb.versions", { n: versionsOf(q, mine).length })}
                        {addons ? ` · ${t("pb.addons", { n: addons })}` : ""}
                      </span>
                    ) : null}
                    <StatusPill file={current} mode={pillMode} status={status} />
                    <span className="ml-auto min-w-24 text-right sm:w-28 font-semibold tabular-nums">{priceLabel(q, quoteEffectiveTotal(q, mine), locale, t("billing.tm.short"))}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </div>
                {!isFolded && kids.length ? (
                  <ul className="divide-y border-t bg-muted/20">
                    {kids.map((k) => (
                      <li key={k.id}>
                        <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-4 pl-10 text-left text-sm hover:bg-muted/50 sm:pl-16" onClick={() => open(k.id)}>
                          <span className="tabular-nums">{k.number}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.is_addon === 1 ? t("pb.addon") : t("pb.version")}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{k.title}</span>
                          <StatusPill file={k} mode={pillMode} status={revisionStatus(k, mine)} />
                          <span className="ml-auto min-w-24 text-right sm:w-28 tabular-nums">{priceLabel(k, k.amount, locale, t("billing.tm.short"))}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            );
          })
        )}
      </section>
      ) : null}

      {/* invoices */}
      {tab === "invoices" ? (
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <ReceiptText className="size-4" />
          {t("pb.invoices")}
          <span className="h-px flex-1 bg-border" aria-hidden />
        </h2>
        {invoices.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">{t("pb.noInvoices")}</Card>
        ) : (
          <Card className="gap-0 overflow-hidden p-0">
            <ul className="divide-y">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/50" onClick={() => open(inv.id)}>
                    <span className="font-semibold tabular-nums">{inv.number}</span>
                    <span className="min-w-0 flex-1 truncate">{inv.title}</span>
                    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{inv.issued_on ? formatDate(inv.issued_on, locale) : ""}</span>
                    <StatusPill file={inv} mode={pillMode} status={displayStatus(inv)} />
                    <span className="ml-auto min-w-24 text-right sm:w-28 font-semibold tabular-nums">{moneyExact(inv.amount, locale)}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      ) : null}
      {viewer ? (
        <BillingFileDialog
          file={viewing}
          allFiles={files}
          requests={requests}
          mode="client"
          canDecide
          canManage={false}
          userId={user?.id ?? 0}
          userName={user?.name ?? ""}
          companyName={client?.company_name ?? ""}
          onClose={() => setViewingId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
