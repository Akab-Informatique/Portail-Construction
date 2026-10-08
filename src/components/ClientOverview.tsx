import { useEffect, useMemo, useState } from "react";
import { FileText, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildProjectMoney, EMPTY_MONEY, type ProjectMoney } from "@/lib/project-money";
import {
  EMPTY_FINANCE,
  loadStaffFinance,
  plannedCostOf,
  removeCostEntry,
  savePlannedCost,
  saveTargetMargin,
  setCostPaid,
  type CostEntry,
  type StaffFinance,
} from "@/lib/project-finance";
import { fileViewUrl } from "@/lib/billing-files";
import { ProjectCostDialog } from "@/components/ProjectCostDialog";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { formatDate, money, percent } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { cn } from "@/lib/utils";
import type { BillingFile, Project } from "@/lib/types";

type UsageKey = "pending" | "unpaid" | "paid" | "cost";
const USAGE_KEY = "frx.budgetUsage2";
const USAGE_DEFAULT: Record<UsageKey, boolean> = { pending: false, unpaid: true, paid: true, cost: false };

function readIncluded(): Record<UsageKey, boolean> {
  try {
    return { ...USAGE_DEFAULT, ...(JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}") as Partial<Record<UsageKey, boolean>>) };
  } catch {
    return { ...USAGE_DEFAULT };
  }
}

const sum = (rows: ProjectMoney[], pick: (m: ProjectMoney) => number) => rows.reduce((total, m) => total + pick(m), 0);

/**
 * "Vue d'ensemble" of a client. Every figure is the total of all the client's projects, or of the one project chosen.
 *  - Clients see two numbers only: the total project cost (accepted quotes) and the total spent (invoices marked paid).
 *  - FRX staff also see the billing picture; admins additionally get a private profitability section.
 * Nothing here is typed in: budget = accepted quotes (add-ons included), spent = paid invoices.
 */
export function ClientOverview({
  projects,
  billing,
  clientView,
  canSeePrivate,
  clientId,
  userId,
}: {
  projects: Project[];
  billing: BillingFile[];
  clientId: number;
  userId: number;
  /** A client, or an admin previewing as a client: only the two client figures are shown. */
  clientView: boolean;
  /** Admin: sees costs, margins and the target margin. */
  canSeePrivate: boolean;
}) {
  const { t, locale } = useI18n();
  const [projectFilter, setProjectFilter] = useState("all");
  const [included, setIncluded] = useState<Record<UsageKey, boolean>>(readIncluded);
  const [finance, setFinance] = useState<StaffFinance>(EMPTY_FINANCE);
  const [targetInput, setTargetInput] = useState("");
  const [plannedInput, setPlannedInput] = useState("");
  const [costDialog, setCostDialog] = useState<"invoice" | "quick" | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const scoped = projectFilter === "all" ? projects : projects.filter((p) => String(p.id) === projectFilter);
  const one = projectFilter !== "all" ? scoped[0] : undefined;
  const moneyMap = useMemo(() => buildProjectMoney(billing), [billing]);
  const rows = scoped.map((p) => moneyMap.get(p.id) ?? EMPTY_MONEY);

  const contract = sum(rows, (m) => m.contract);
  const contractNet = sum(rows, (m) => m.contractNet);
  const invoiced = sum(rows, (m) => m.invoiced);
  const invoicedNet = sum(rows, (m) => m.invoicedNet);
  const paid = sum(rows, (m) => m.paid);
  const paidNet = sum(rows, (m) => m.paidNet);
  const unpaid = sum(rows, (m) => m.unpaid);
  const pending = sum(rows, (m) => m.pending);
  const quotesAccepted = sum(rows, (m) => m.quotesAccepted);

  const projectIds = projects.map((p) => p.id).join(",");
  const reloadFinance = () =>
    loadStaffFinance(projects.map((p) => p.id))
      .then(setFinance)
      .catch((err) => console.error("staff finance failed", err));

  useEffect(() => {
    if (!canSeePrivate || clientView) return;
    void reloadFinance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeePrivate, clientView, projectIds]);

  // Private numbers (before taxes): what the work costs against what the contract brings in.
  const scopedIds = new Set(scoped.map((p) => p.id));
  const scopedCosts = finance.costs.filter((c) => scopedIds.has(c.project_id));
  const actualCost = scopedCosts.reduce((total, c) => total + c.amount, 0);
  const paidCost = scopedCosts.filter((c) => c.paid === 1).reduce((total, c) => total + c.amount, 0);
  const unpaidCost = actualCost - paidCost;
  const actualOf = (p: Project) => scopedCosts.filter((c) => c.project_id === p.id).reduce((total, c) => total + c.amount, 0);
  const estimatedCost = scoped.reduce((total, p) => total + plannedCostOf(finance, p.id), 0);
  // If real costs go past the plan, the real figure is what the margin must be measured with.
  const projectedCost = scoped.reduce((total, p) => total + Math.max(plannedCostOf(finance, p.id), actualOf(p)), 0);
  const marginAmount = contractNet - projectedCost;
  const marginPct = contractNet > 0 ? (marginAmount / contractNet) * 100 : null;

  const targetFor = (p: Project) => finance.targets.get(p.id);
  const withTarget = scoped.filter((p) => targetFor(p) !== undefined && (moneyMap.get(p.id)?.contractNet ?? 0) > 0);
  const weight = withTarget.reduce((s, p) => s + (moneyMap.get(p.id)?.contractNet ?? 0), 0);
  const target = one
    ? targetFor(one) ?? null
    : weight > 0
      ? withTarget.reduce((s, p) => s + (targetFor(p) as number) * (moneyMap.get(p.id)?.contractNet ?? 0), 0) / weight
      : null;

  useEffect(() => {
    setTargetInput(one && targetFor(one) !== undefined ? String(targetFor(one)) : "");
    setPlannedInput(one && finance.planned.has(one.id) ? String(finance.planned.get(one.id)) : "");
    setSavedNote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, finance]);

  const maxCostForTarget = target !== null ? contractNet * (1 - target / 100) : null;
  const room = maxCostForTarget !== null ? maxCostForTarget - actualCost : null;
  const diff = marginPct !== null && target !== null ? marginPct - target : null;
  const verdict: "none" | "good" | "warn" | "bad" = diff === null ? "none" : diff >= 0 ? "good" : diff >= -3 ? "warn" : "bad";
  const hasCosts = estimatedCost > 0 || actualCost > 0;
  const projectLabel = new Map(projects.map((p) => [p.id, p.project_number || p.name]));

  async function saveTarget() {
    if (!one) return;
    const value = targetInput.trim() === "" ? null : Number(targetInput);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value >= 100)) return;
    await saveTargetMargin(one.id, value);
    setFinance((current) => {
      const targets = new Map(current.targets);
      if (value === null) targets.delete(one.id);
      else targets.set(one.id, value);
      return { ...current, targets };
    });
    setSavedNote(true);
  }

  async function savePlanned() {
    if (!one) return;
    const value = plannedInput.trim() === "" ? null : Number(plannedInput);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    await savePlannedCost(one.id, value);
    await reloadFinance();
    setSavedNote(true);
  }

  async function fileRow(id: number | null) {
    if (!id) return null;
    const rows = await db.select().from(schema.billing_files).where(eq(schema.billing_files.id, id));
    return (rows[0] as BillingFile | undefined) ?? null;
  }

  async function openSupplierPdf(entry: CostEntry) {
    const row = await fileRow(entry.file_id);
    if (row) window.open(await fileViewUrl(row), "_blank", "noreferrer");
  }

  async function deleteCost(entry: CostEntry) {
    if (!window.confirm(t("cost.deleteConfirm"))) return;
    await removeCostEntry(entry, await fileRow(entry.file_id));
    await reloadFinance();
  }

  async function togglePaid(entry: CostEntry, on: boolean) {
    await setCostPaid(entry, on);
    await reloadFinance();
  }

  function toggleLine(key: UsageKey, on: boolean) {
    setIncluded((current) => {
      const next = { ...current, [key]: on };
      try {
        localStorage.setItem(USAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  const usageLines: { key: UsageKey; label: MessageKey; amount: number }[] = [
    { key: "pending", label: "clients.usage.quoted", amount: pending },
    { key: "unpaid", label: "clients.usage.unpaid", amount: unpaid },
    { key: "paid", label: "clients.usage.paid", amount: paid },
    ...(canSeePrivate ? [{ key: "cost" as const, label: "clients.usage.spent" as MessageKey, amount: actualCost }] : []),
  ];
  const selectedTotal = usageLines.filter((l) => included[l.key]).reduce((s, l) => s + l.amount, 0);
  const selectedPct = percent(selectedTotal, contract);

  const picker = (
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor="dashboard-project" className="text-sm text-muted-foreground">
        {t("clients.projectFilter.label")}
      </Label>
      <Select value={projectFilter} onValueChange={setProjectFilter}>
        <SelectTrigger id="dashboard-project" className="w-full max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("clients.projectFilter.all")}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.project_number ? `${p.project_number} · ` : ""}
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">{t("ov.count", { n: scoped.length })}</span>
    </div>
  );

  // ---------------- what a client sees ----------------
  if (clientView) {
    const pct = percent(paid, contract);
    return (
      <div className="space-y-5">
        {picker}
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyCard
            label={one ? t("ov.client.cost") : t("ov.client.costAll")}
            value={money(contract, locale)}
            hint={t("ov.client.costHint", { n: quotesAccepted })}
          />
          <MoneyCard label={t("ov.client.spent")} value={money(paid, locale)} hint={t("ov.client.spentHint", { pct })} />
        </div>
        <Card className="gap-2 p-5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{t("ov.client.progress")}</span>
            <span className="tabular-nums text-muted-foreground">{pct} %</span>
          </div>
          <Bar pct={pct} />
        </Card>
      </div>
    );
  }

  // ---------------- FRX staff ----------------
  return (
    <div className="space-y-5">
      {picker}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MoneyCard
          label={one ? t("clients.stat.projectBudget") : t("clients.stat.contract")}
          value={money(contract, locale)}
          hint={t("ov.budgetHint", { n: quotesAccepted })}
        />
        <MoneyCard label={t("ov.pending")} value={money(pending, locale)} hint={t("ov.pendingHint")} />
        <MoneyCard label={t("ov.invoiced")} value={money(invoiced, locale)} hint={t("ov.invoicedHint", { amount: money(Math.max(contract - invoiced, 0), locale) })} />
        <MoneyCard label={t("ov.paid")} value={money(paid, locale)} hint={t("ov.paidHint", { pct: percent(paid, contract) })} />
        <MoneyCard
          label={t("ov.toCollect")}
          value={money(Math.max(contract - paid, 0), locale)}
          hint={t("ov.toCollectHint", { amount: money(unpaid, locale) })}
        />
      </div>

      <Card className="py-0">
        <CardHeader className="border-b px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle className="text-base">{t("clients.usage.title")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {one ? t("clients.stat.projectBudget") : t("clients.usage.budget")}:{" "}
              <span className="font-medium tabular-nums text-foreground">{money(contract, locale)}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{t("clients.usage.pick")}</p>
        </CardHeader>
        <CardContent className="grid gap-4 px-5 py-5">
          {usageLines.map((line) => {
            const pct = percent(line.amount, contract);
            const label = t(line.label);
            return (
              <label key={line.key} className="grid cursor-pointer items-center gap-x-4 gap-y-1 sm:grid-cols-[1.25rem_15rem_minmax(0,1fr)_auto_3.5rem]">
                <Checkbox checked={included[line.key]} onCheckedChange={(v) => toggleLine(line.key, v === true)} aria-label={label} />
                <span className="text-sm font-medium">{label}</span>
                <Bar pct={pct} muted={!included[line.key]} />
                <span className="text-sm font-medium tabular-nums sm:text-right">{money(line.amount, locale)}</span>
                <span className={cn("text-sm tabular-nums sm:text-right", pct > 100 ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{pct} %</span>
              </label>
            );
          })}
          <div className="grid items-center gap-x-4 gap-y-1 border-t pt-4 sm:grid-cols-[1.25rem_15rem_minmax(0,1fr)_auto_3.5rem]">
            <span />
            <span className="text-sm font-semibold">{t("clients.usage.selected")}</span>
            <Bar pct={selectedPct} thick />
            <span className="text-sm font-semibold tabular-nums sm:text-right">{money(selectedTotal, locale)}</span>
            <span className={cn("text-sm font-semibold tabular-nums sm:text-right", selectedPct > 100 && "text-rose-600 dark:text-rose-400")}>{selectedPct} %</span>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {selectedTotal > contract
              ? t("clients.usage.over", { amount: money(selectedTotal - contract, locale) })
              : t("clients.usage.left", { amount: money(contract - selectedTotal, locale) })}
          </p>
        </CardContent>
      </Card>

      {canSeePrivate ? (
        <>
          <Card className="border-dashed border-primary/50 py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="size-4 text-primary" />
                {t("ov.private.title")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t("ov.private.note")}</p>
            </CardHeader>
            <CardContent className="grid gap-6 px-5 py-5 lg:grid-cols-[1.15fr_1fr]">
              <table className="w-full text-sm">
                <tbody>
                  <GroupRow label={t("ov.t.revenue")} />
                  <TableRow label={t("ov.p.contract")} value={money(contractNet, locale)} />
                  <TableRow label={t("ov.p.invoiced")} value={money(invoicedNet, locale)} />
                  <TableRow label={t("ov.p.paid")} value={money(paidNet, locale)} />
                  <TableRow label={t("ov.t.toCollect")} value={money(Math.max(contractNet - paidNet, 0), locale)} strong />

                  <GroupRow label={t("ov.t.costs")} />
                  <TableRow
                    label={t("ov.t.planned")}
                    hint={one ? undefined : t("ov.t.plannedAll")}
                    value={
                      one ? (
                        <span className="inline-flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            step="100"
                            className="h-8 w-32 text-right"
                            placeholder="0"
                            value={plannedInput}
                            onChange={(e) => {
                              setPlannedInput(e.target.value);
                              setSavedNote(false);
                            }}
                          />
                          <Button type="button" size="sm" variant="outline" onClick={() => void savePlanned()}>
                            {t("ov.p.save")}
                          </Button>
                        </span>
                      ) : (
                        money(estimatedCost, locale)
                      )
                    }
                  />
                  <TableRow label={t("ov.t.actual")} value={money(actualCost, locale)} strong />
                  <TableRow label={t("ov.t.paidCost")} value={money(paidCost, locale)} indent />
                  <TableRow label={t("ov.t.unpaidCost")} value={money(unpaidCost, locale)} indent />
                  <TableRow
                    label={t("ov.t.plannedLeft")}
                    value={money(estimatedCost - actualCost, locale)}
                    negative={estimatedCost - actualCost < 0 && estimatedCost > 0}
                  />

                  <GroupRow label={t("ov.t.margins")} />
                  <TableRow label={t("ov.p.cashMargin")} value={money(invoicedNet - actualCost, locale)} negative={invoicedNet - actualCost < 0} />
                  <TableRow label={t("ov.t.cashIn")} value={money(paidNet - paidCost, locale)} negative={paidNet - paidCost < 0} />
                  <TableRow label={t("ov.p.projectedMargin")} value={money(marginAmount, locale)} strong negative={marginAmount < 0} />
                </tbody>
              </table>

              <div className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{t("ov.p.projectedMargin")}</span>
                  <span className={cn("font-display text-2xl font-semibold tabular-nums", marginAmount < 0 && "text-rose-600 dark:text-rose-400")}>
                    {marginPct !== null ? `${marginPct.toFixed(1)} %` : "—"}
                  </span>
                </div>

                <div className="flex flex-wrap items-end gap-3 rounded-md border px-3 py-3">
                  <div className="min-w-[8rem] space-y-1.5">
                    <Label htmlFor="target-margin">{t("ov.p.target")}</Label>
                    {one ? (
                      <div className="flex items-center gap-2">
                        <Input
                          id="target-margin"
                          type="number"
                          min="0"
                          max="95"
                          step="0.5"
                          className="w-24"
                          placeholder="20"
                          value={targetInput}
                          onChange={(e) => {
                            setTargetInput(e.target.value);
                            setSavedNote(false);
                          }}
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    ) : (
                      <p className="font-medium tabular-nums">{target !== null ? `${target.toFixed(1)} %` : "—"}</p>
                    )}
                  </div>
                  {one ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void saveTarget()}>
                      {t("ov.p.save")}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("ov.p.pickOne")}</p>
                  )}
                  {savedNote ? <p className="text-xs text-muted-foreground">{t("settings.saved")}</p> : null}
                </div>

                <div
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-sm font-medium",
                    verdict === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                    verdict === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
                    verdict === "bad" && "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
                    verdict === "none" && "text-muted-foreground",
                  )}
                  role="status"
                >
                  {verdict === "none"
                    ? t("ov.v.none")
                    : verdict === "good"
                      ? t("ov.v.good", { diff: Math.abs(diff ?? 0).toFixed(1) })
                      : verdict === "warn"
                        ? t("ov.v.warn", { diff: Math.abs(diff ?? 0).toFixed(1) })
                        : t("ov.v.bad", { diff: Math.abs(diff ?? 0).toFixed(1) })}
                </div>

                {maxCostForTarget !== null && room !== null ? (
                  <div className="space-y-1.5">
                    <TableLine label={t("ov.p.maxCost")} value={money(maxCostForTarget, locale)} />
                    <TableLine label={room >= 0 ? t("ov.p.room") : t("ov.p.roomOver")} value={money(Math.abs(room), locale)} negative={room < 0} strong />
                  </div>
                ) : null}
                {actualCost > estimatedCost && estimatedCost > 0 ? (
                  <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    {t("ov.p.overCost", { amount: money(actualCost - estimatedCost, locale) })}
                  </p>
                ) : null}
                {!hasCosts ? <p className="text-xs text-muted-foreground">{t("ov.t.noCosts")}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-dashed border-primary/50 py-0">
            <CardHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="size-4 text-primary" />
                  {t("ov.costs.title")}
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={projects.length === 0} onClick={() => setCostDialog("invoice")}>
                    <Plus className="size-3.5" />
                    {t("ov.costs.addInvoice")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={projects.length === 0} onClick={() => setCostDialog("quick")}>
                    <Plus className="size-3.5" />
                    {t("ov.costs.addQuick")}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("ov.costs.note")}</p>
            </CardHeader>
            <CardContent className="px-0 py-0">
              {scopedCosts.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">{t("ov.costs.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 font-medium">{t("billing.issued")}</th>
                        {one ? null : <th className="px-3 py-2.5 font-medium">{t("billing.project")}</th>}
                        <th className="px-3 py-2.5 font-medium">{t("cost.supplier")}</th>
                        <th className="px-3 py-2.5 text-right font-medium">{t("cost.amount")}</th>
                        <th className="px-3 py-2.5 font-medium">{t("cost.paid")}</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {[...scopedCosts]
                        .sort((x, y) => String(y.incurred_on ?? "").localeCompare(String(x.incurred_on ?? "")))
                        .map((entry) => (
                          <tr key={entry.id}>
                            <td className="px-5 py-2.5 tabular-nums text-muted-foreground">{formatDate(entry.incurred_on, locale)}</td>
                            {one ? null : <td className="px-3 py-2.5 text-muted-foreground">{projectLabel.get(entry.project_id) ?? "—"}</td>}
                            <td className="px-3 py-2.5">
                              <p className="font-medium">{entry.supplier || (entry.source === "quick" ? t("ov.costs.addQuick") : "—")}</p>
                              {entry.description ? <p className="text-xs text-muted-foreground">{entry.description}</p> : null}
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(entry.amount, locale)}</td>
                            <td className="px-3 py-2.5">
                              <Checkbox checked={entry.paid === 1} onCheckedChange={(v) => void togglePaid(entry, v === true)} aria-label={t("cost.paid")} />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end gap-1.5">
                                {entry.file_id ? (
                                  <Button type="button" size="icon-sm" variant="outline" title={t("cost.viewPdf")} onClick={() => void openSupplierPdf(entry)}>
                                    <FileText className="size-3.5" />
                                  </Button>
                                ) : null}
                                <Button type="button" size="icon-sm" variant="outline" title={t("billing.delete")} onClick={() => void deleteCost(entry)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <ProjectCostDialog
            open={costDialog !== null}
            mode={costDialog ?? "quick"}
            projects={projects}
            defaultProjectId={one?.id ?? null}
            clientId={clientId}
            userId={userId}
            onClose={() => setCostDialog(null)}
            onSaved={() => {
              setCostDialog(null);
              void reloadFinance();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function GroupRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:pt-0">
        {label}
      </td>
    </tr>
  );
}

function TableRow({
  label,
  value,
  strong,
  negative,
  indent,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  negative?: boolean;
  indent?: boolean;
  hint?: string;
}) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className={cn("py-1.5 pr-4 text-muted-foreground", indent && "pl-5", strong && "font-medium text-foreground")}>
        {label}
        {hint ? <span className="block text-xs">{hint}</span> : null}
      </td>
      <td className={cn("py-1.5 text-right tabular-nums", strong && "font-semibold", negative && "text-rose-600 dark:text-rose-400")}>{value}</td>
    </tr>
  );
}

function TableLine({ label, value, strong, negative }: { label: string; value: string; strong?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold", negative && "text-rose-600 dark:text-rose-400")}>{value}</span>
    </div>
  );
}

function MoneyCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-[13px] font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Bar({ pct, muted, thick }: { pct: number; muted?: boolean; thick?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-muted", thick ? "h-3" : "h-2.5")} role="progressbar" aria-valuenow={Math.min(pct, 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full", pct > 100 ? "bg-rose-500" : muted ? "bg-muted-foreground/40" : "bg-primary")}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}
