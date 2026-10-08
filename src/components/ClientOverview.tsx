import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildProjectMoney, EMPTY_MONEY, type ProjectMoney } from "@/lib/project-money";
import { loadStaffFinance, saveTargetMargin, type StaffFinance } from "@/lib/project-finance";
import { money, percent } from "@/lib/format";
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
}: {
  projects: Project[];
  billing: BillingFile[];
  /** A client, or an admin previewing as a client: only the two client figures are shown. */
  clientView: boolean;
  /** Admin: sees costs, margins and the target margin. */
  canSeePrivate: boolean;
}) {
  const { t, locale } = useI18n();
  const [projectFilter, setProjectFilter] = useState("all");
  const [included, setIncluded] = useState<Record<UsageKey, boolean>>(readIncluded);
  const [finance, setFinance] = useState<StaffFinance>({ costs: new Map(), targets: new Map() });
  const [targetInput, setTargetInput] = useState("");
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
  useEffect(() => {
    if (!canSeePrivate || clientView) return;
    let active = true;
    loadStaffFinance(projects.map((p) => p.id))
      .then((data) => active && setFinance(data))
      .catch((err) => console.error("staff finance failed", err));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeePrivate, clientView, projectIds]);

  // Private numbers (before taxes): what the work costs against what the contract brings in.
  const costOf = (p: Project) => finance.costs.get(p.id) ?? { estimated: 0, actual: 0 };
  const estimatedCost = scoped.reduce((s, p) => s + costOf(p).estimated, 0);
  const actualCost = scoped.reduce((s, p) => s + costOf(p).actual, 0);
  // If real costs go past the plan, the real figure is what the margin must be measured with.
  const projectedCost = scoped.reduce((s, p) => s + Math.max(costOf(p).estimated, costOf(p).actual), 0);
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
    setSavedNote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, finance]);

  const maxCostForTarget = target !== null ? contractNet * (1 - target / 100) : null;
  const room = maxCostForTarget !== null ? maxCostForTarget - actualCost : null;
  const diff = marginPct !== null && target !== null ? marginPct - target : null;
  const verdict: "none" | "good" | "warn" | "bad" = diff === null ? "none" : diff >= 0 ? "good" : diff >= -3 ? "warn" : "bad";
  const hasCosts = estimatedCost > 0 || actualCost > 0;

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
        <Card className="border-dashed border-primary/50 py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-primary" />
              {t("ov.private.title")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("ov.private.note")}</p>
          </CardHeader>
          <CardContent className="grid gap-6 px-5 py-5 lg:grid-cols-2">
            <div className="space-y-2 text-sm">
              <Line label={t("ov.p.contract")} value={money(contractNet, locale)} />
              <Line label={t("ov.p.invoiced")} value={money(invoicedNet, locale)} />
              <Line label={t("ov.p.paid")} value={money(paidNet, locale)} />
              <div className="my-2 border-t" />
              <Line label={t("ov.p.estimated")} value={money(estimatedCost, locale)} />
              <Line label={t("ov.p.actual")} value={money(actualCost, locale)} strong />
              <Line label={t("ov.p.cashMargin")} value={money(invoicedNet - actualCost, locale)} negative={invoicedNet - actualCost < 0} />
              <Line label={t("ov.p.paidMargin")} value={money(paidNet - actualCost, locale)} negative={paidNet - actualCost < 0} />
              {actualCost > estimatedCost && estimatedCost > 0 ? (
                <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  {t("ov.p.overCost", { amount: money(actualCost - estimatedCost, locale) })}
                </p>
              ) : null}
              {!hasCosts ? <p className="text-xs text-muted-foreground">{t("ov.p.noCosts")}</p> : null}
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{t("ov.p.projectedMargin")}</span>
                <span className={cn("font-display text-2xl font-semibold tabular-nums", marginAmount < 0 && "text-rose-600 dark:text-rose-400")}>
                  {money(marginAmount, locale)}
                  {marginPct !== null ? <span className="ml-2 text-base text-muted-foreground">{marginPct.toFixed(1)} %</span> : null}
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
                  <Line label={t("ov.p.maxCost")} value={money(maxCostForTarget, locale)} />
                  <Line
                    label={room >= 0 ? t("ov.p.room") : t("ov.p.roomOver")}
                    value={money(Math.abs(room), locale)}
                    negative={room < 0}
                    strong
                  />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
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

function Line({ label, value, strong, negative }: { label: string; value: string; strong?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold", negative && "text-rose-600 dark:text-rose-400")}>{value}</span>
    </div>
  );
}
