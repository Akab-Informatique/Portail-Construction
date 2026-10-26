import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Flag, Loader2, Sparkles, TrendingUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate, todayISO } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { computeForecast, type Dep, type ForecastItem } from "@/lib/schedule-forecast";
import type { Task } from "@/lib/schedule-tree";
import { fetchAiSummary } from "@/lib/daily-summary";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DAY = 86400000;
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

const aiKey = (id: number, locale: string) => `frx.forecastAi.${id}.${locale}`;

/**
 * Forecast: where the job will really end, given what is done and what waits for what. It points at the tasks
 * holding things up (an unfinished predecessor, work not started past its date) and can ask the AI to look again.
 */
export function ScheduleForecast({
  project,
  tasks,
  deps,
  check,
  onOpen,
}: {
  project: Project;
  tasks: Task[];
  deps: Dep[];
  check: Record<number, { done: number; total: number }>;
  onOpen: (id: number) => void;
}) {
  const { t, locale } = useI18n();
  const color = projectColor(project);
  const today = todayISO();
  const fc = useMemo(() => computeForecast(tasks, deps, check, project.end_date, today), [tasks, deps, check, project.end_date, today]);
  const phaseOf = (task: Task) => tasks.find((p) => p.id === task.parent_id)?.title ?? "";

  const stuck = fc.items.filter((i) => i.state === "held" || i.state === "late").sort((a, b) => b.slipDays - a.slipDays);
  const slipTone = fc.slipDays === 0 ? "text-emerald-600 dark:text-emerald-400" : fc.slipDays <= 7 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  // ---- AI analysis ----
  const [analysis, setAnalysis] = useState<{ text: string; at: string; ai: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(aiKey(project.id, locale));
      setAnalysis(raw ? (JSON.parse(raw) as { text: string; at: string; ai: boolean }) : null);
    } catch {
      setAnalysis(null);
    }
  }, [project.id, locale]);

  function rulesText() {
    const lines: string[] = [];
    if (!fc.plannedEnd || !fc.forecastEnd) lines.push(t("fc.noDates"));
    else if (fc.slipDays === 0) lines.push(t("fc.r.onTime", { date: formatDate(fc.plannedEnd, locale) }));
    else lines.push(t("fc.r.slip", { planned: formatDate(fc.plannedEnd, locale), forecast: formatDate(fc.forecastEnd, locale), n: fc.slipDays }));
    for (const i of stuck.slice(0, 4)) {
      if (i.state === "held") lines.push(t("fc.r.held", { task: i.task.title, by: i.waitingFor.map((w) => w.title).join(", "), n: i.slipDays }));
      else lines.push(t("fc.r.late", { task: i.task.title, n: i.slipDays }));
    }
    return lines.map((l) => `- ${l}`).join("\n");
  }

  async function analyze() {
    setBusy(true);
    const facts = {
      project: project.name,
      today,
      plannedEnd: fc.plannedEnd,
      forecastEnd: fc.forecastEnd,
      slipDays: fc.slipDays,
      progressPercent: fc.progress,
      tasks: fc.items.slice(0, 80).map((i) => ({
        title: i.task.title,
        phase: phaseOf(i.task) || null,
        status: i.task.status,
        progressPercent: i.progress,
        plannedStart: i.planStart,
        plannedEnd: i.planEnd,
        forecastEnd: i.forecastEnd,
        slipDays: i.slipDays,
        state: i.state,
        waitingFor: i.waitingFor.map((w) => w.title),
        onCriticalPath: i.critical,
      })),
    };
    const written = await fetchAiSummary(facts, locale, "forecast");
    const next = written ? { text: written, at: new Date().toISOString(), ai: true } : { text: rulesText(), at: new Date().toISOString(), ai: false };
    setAnalysis(next);
    try {
      localStorage.setItem(aiKey(project.id, locale), JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    setBusy(false);
  }

  const lines = (analysis?.text ?? "").split("\n").map((l) => l.replace(/^[-•]\s*/, "").trim()).filter(Boolean);

  const chips: { label: string; n: number; cls: string; Icon: typeof Clock }[] = [
    { label: t("fc.state.ontrack"), n: fc.counts.ontrack, cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
    { label: t("fc.state.late"), n: fc.counts.late, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", Icon: Clock },
    { label: t("fc.state.held"), n: fc.counts.held, cls: "bg-red-500/15 text-red-700 dark:text-red-300", Icon: AlertTriangle },
    { label: t("fc.state.done"), n: fc.counts.done, cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300", Icon: Flag },
  ];

  const bar = (i: ForecastItem) => {
    const all = [i.planStart, i.planEnd, i.forecastEnd].filter(Boolean) as string[];
    if (all.length === 0) return null;
    return all;
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("fc.plannedEnd")}</p>
          <p className="font-display text-3xl leading-none">{fc.plannedEnd ? formatDate(fc.plannedEnd, locale) : "—"}</p>
        </Card>
        <Card className="gap-1 p-5" style={{ boxShadow: `var(--glass-shadow), inset 4px 0 0 ${color}` }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("fc.forecastEnd")}</p>
          <p className="font-display text-3xl leading-none">{fc.forecastEnd ? formatDate(fc.forecastEnd, locale) : "—"}</p>
          <p className={cn("text-sm font-semibold", slipTone)}>{fc.slipDays === 0 ? t("fc.onTime") : t("fc.slip", { n: fc.slipDays })}</p>
        </Card>
        <Card className="gap-1 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("gantt.achievement")}</p>
          <p className="font-display text-3xl leading-none tabular-nums">{fc.progress}%</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
            <div className="h-full rounded-full" style={{ width: `${fc.progress}%`, background: color }} />
          </div>
        </Card>
        <Card className="gap-2 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("fc.tasks")}</p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c.label} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", c.cls)}>
                <c.Icon className="size-3.5" />
                {c.n} {c.label}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* AI */}
      <Card className="gap-3 p-5" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${color} 10%, var(--card)), var(--card))` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <TrendingUp className="size-4" style={{ color }} />
            {t("fc.analysis")}
            {analysis ? <span className="font-normal normal-case tracking-normal">· {analysis.ai ? t("fc.byAi") : t("fc.byRules")} · {new Date(analysis.at).toLocaleString(locale)}</span> : null}
          </h3>
          <Button onClick={() => void analyze()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("fc.reanalyze")}
          </Button>
        </div>
        {lines.length > 0 ? (
          <ul className="space-y-2 text-sm leading-relaxed">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <ArrowRight className="mt-1 size-3.5 shrink-0" style={{ color }} />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("fc.analysisHint")}</p>
        )}
      </Card>

      {/* what is holding things up */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <AlertTriangle className="size-4" />
          {t("fc.holdingUp")}
          <span className="h-px flex-1 bg-border" aria-hidden />
        </h3>
        {stuck.length === 0 ? (
          <Card className="flex-row items-center gap-3 p-5 text-sm">
            <CheckCircle2 className="size-5 text-emerald-500" />
            {t("fc.nothing")}
          </Card>
        ) : (
          <ul className="space-y-2">
            {stuck.map((i) => {
              const dates = bar(i);
              const min = dates ? dates.reduce((m, d) => (d < m ? d : m)) : "";
              const max = dates ? dates.reduce((m, d) => (d > m ? d : m)) : "";
              const span = dates ? Math.max(1, (at(max) - at(min)) / DAY) : 1;
              const pct = (iso: string | null) => (iso && dates ? ((at(iso) - at(min)) / DAY / span) * 100 : 0);
              return (
                <li key={i.task.id}>
                  <button type="button" onClick={() => onOpen(i.task.id)} className="frx-glass block w-full border border-[color:var(--glass-edge)] px-4 py-3 text-left transition-all hover:-translate-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{i.task.title}</span>
                      {phaseOf(i.task) ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{phaseOf(i.task)}</span> : null}
                      {i.critical ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">{t("fc.critical")}</span> : null}
                      <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums", i.state === "held" ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>+{i.slipDays} {t("fc.days")}</span>
                    </div>
                    {i.waitingFor.length ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("fc.waitsFor")} <span className="font-medium text-foreground">{i.waitingFor.map((w) => w.title).join(", ")}</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">{t("fc.ownPace")}</p>
                    )}
                    {dates ? (
                      <div className="relative mt-2.5 h-5">
                        <span className="absolute top-0 h-2 rounded-full bg-muted-foreground/30" style={{ left: `${pct(i.planStart)}%`, width: `${Math.max(2, pct(i.planEnd) - pct(i.planStart))}%` }} />
                        <span className="absolute top-3 h-2 rounded-full" style={{ left: `${pct(i.forecastStart)}%`, width: `${Math.max(2, pct(i.forecastEnd) - pct(i.forecastStart))}%`, background: i.state === "held" ? "#ef4444" : "#f59e0b" }} />
                      </div>
                    ) : null}
                    <p className="mt-1 flex flex-wrap gap-x-4 text-[11px] tabular-nums text-muted-foreground">
                      <span>{t("fc.plan")}: {i.planStart ? formatDate(i.planStart, locale) : "…"} → {i.planEnd ? formatDate(i.planEnd, locale) : "…"}</span>
                      <span>{t("fc.forecast")}: {i.forecastStart ? formatDate(i.forecastStart, locale) : "…"} → {i.forecastEnd ? formatDate(i.forecastEnd, locale) : "…"}</span>
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
