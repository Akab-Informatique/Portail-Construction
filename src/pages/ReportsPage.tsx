import { useEffect, useMemo, useState } from "react";
import { Download, FilePlus2, Lock, Presentation } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { useWorkspace } from "@/lib/workspace";
import { getCompanyProfile } from "@/lib/settings";
import { downloadReportPdf } from "@/lib/report-pdf";
import { loadReportGrants } from "@/lib/report-access";
import { todayISO } from "@/lib/format";
import { REPORT_SECTIONS, STANDARD_REPORTS, buildReport, type ReportSectionId } from "@/lib/project-report";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const PRESETS = ["month", "last30", "quarter", "year", "all"] as const;
type Preset = (typeof PRESETS)[number];

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const today = iso(now);
  if (p === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (p === "last30") return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)), to: today };
  if (p === "quarter") return { from: iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: today };
  if (p === "year") return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today };
  return { from: "", to: "" };
}

/**
 * Reports. The administrator decides, in Setup, who may generate which report and which chapters the custom generator
 * offers. Everything a report holds is read from what the person can already see: their projects, inside the chosen period.
 */
export function ReportsPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { projects, clients, selectedClient, clientProjects } = useWorkspace();
  const jobs = selectedClient ? clientProjects : projects;
  const asClient = user?.user_type === "external" || user?.view_as === "client";
  const [grants, setGrants] = useState<Set<string> | null>(null);
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [from, setFrom] = useState(() => presetRange("month").from);
  const [to, setTo] = useState(() => presetRange("month").to);
  const [jobId, setJobId] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customJobs, setCustomJobs] = useState<number[] | null>(null);
  const [customSections, setCustomSections] = useState<ReportSectionId[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadReportGrants(asClient ? null : user)
      .then((g) => !cancelled && setGrants(g))
      .catch(() => !cancelled && setGrants(new Set()));
    return () => {
      cancelled = true;
    };
  }, [user, asClient]);

  const standard = useMemo(() => STANDARD_REPORTS.filter((r) => grants?.has(`report:${r.id}`)), [grants]);
  const canCustom = Boolean(grants?.has("report:custom"));
  const offered = useMemo(() => REPORT_SECTIONS.filter((s) => grants?.has(`section:${s.id}`)), [grants]);
  const chosenJobs = customJobs ?? jobs.map((j) => j.id);

  const selectedJobs = useMemo(() => {
    if (jobId === "all") return jobs;
    const one = jobs.find((p) => String(p.id) === jobId);
    return one ? [one] : jobs;
  }, [jobId, jobs]);

  async function generate(key: string, title: string, sections: ReportSectionId[], list: typeof jobs) {
    if (list.length === 0 || sections.length === 0) return;
    setBusy(key);
    setError(null);
    try {
      const company = await getCompanyProfile();
      const report = await buildReport({
        title,
        sections,
        projects: list,
        clients,
        company,
        locale,
        preparedBy: user?.name ?? "",
        from: from || null,
        to: to || null,
        t: (k, vars) => t(k as never, vars as never),
      });
      await downloadReportPdf(report, locale);
    } catch (err) {
      console.error("report failed", err);
      setError(t("reports.failed"));
    } finally {
      setBusy(null);
    }
  }

  if (grants === null) return <PageSkeleton />;
  if (asClient || (standard.length === 0 && !canCustom)) {
    return <EmptyState icon={<Lock className="size-5" />} title={t("reports.hub.title")} description={t("reports.none")} />;
  }

  const pick = (p: Preset) => {
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("reports.hub.title")} />

      {/* the period every report covers */}
      <Card className="gap-4 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label>{t("reports.from")}</Label>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("reports.to")}</Label>
            <Input type="date" value={to} min={from || undefined} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p} type="button" size="sm" variant="outline" onClick={() => pick(p)}>
                {t(`reports.preset.${p}` as MessageKey)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {standard.length > 0 && canCustom ? (
        <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
          {(["standard", "custom"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {id === "standard" ? <Presentation className="size-4" /> : <FilePlus2 className="size-4" />}
              {t(`reports.tab.${id}` as MessageKey)}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {jobs.length === 0 ? (
        <EmptyState icon={<Presentation className="size-5" />} title={t("reports.hub.empty")} description={t("reports.hub.hint")} />
      ) : (tab === "standard" && standard.length > 0) || !canCustom ? (
        <>
          <Card className="max-w-xl gap-3 p-4">
            <Label>{t("reports.hub.pickJob")}</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reports.hub.allJobs")}</SelectItem>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={String(job.id)}>
                    {job.project_number} · {job.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {standard.map((kind) => (
              <Card key={kind.id} className="gap-4 p-5" style={{ boxShadow: "var(--glass-shadow), inset 0 3px 0 #faa32b" }}>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("reports.standard")}</p>
                  <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">{t(kind.titleKey as never)}</h2>
                </div>
                <Button onClick={() => void generate(kind.id, t(kind.titleKey as never), kind.sections, selectedJobs)} disabled={busy !== null}>
                  <Download className="size-4" />
                  {busy === kind.id ? t("reports.hub.busy") : t("reports.hub.export")}
                </Button>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Card className="gap-6 p-6" style={{ boxShadow: "var(--glass-shadow), inset 0 3px 0 #faa32b" }}>
          <div className="max-w-xl space-y-1.5">
            <Label>{t("reports.custom.name")}</Label>
            <Input correct value={customTitle} placeholder={t("reports.untitled")} onChange={(e) => setCustomTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{t("reports.custom.pickJobs")}</Label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setCustomJobs(jobs.map((j) => j.id))}>
                  {t("timesheet.exportAll")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCustomJobs([])}>
                  {t("timesheet.exportNone")}
                </Button>
              </div>
            </div>
            <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {jobs.map((job) => (
                <li key={job.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                    <Checkbox checked={chosenJobs.includes(job.id)} onCheckedChange={(v) => setCustomJobs(v === true ? [...new Set([...chosenJobs, job.id])] : chosenJobs.filter((x) => x !== job.id))} />
                    <span className="truncate">
                      {job.project_number} · {job.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <Label>{t("reports.custom.pickSections")}</Label>
            {offered.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.custom.noSections")}</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {offered.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
                      <Checkbox checked={customSections.includes(s.id)} onCheckedChange={(v) => setCustomSections(v === true ? [...customSections, s.id] : customSections.filter((x) => x !== s.id))} />
                      <span className="flex-1">{t(s.labelKey as MessageKey)}</span>
                      {s.money ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">$</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <Button
              onClick={() =>
                void generate(
                  "custom",
                  customTitle.trim() || t("reports.untitled"),
                  // chapters keep the order of the catalogue, whatever the order they were ticked in
                  REPORT_SECTIONS.map((s) => s.id).filter((id) => customSections.includes(id) && grants.has(`section:${id}`)),
                  jobs.filter((j) => chosenJobs.includes(j.id)),
                )
              }
              disabled={busy !== null || customSections.length === 0 || chosenJobs.length === 0}
            >
              <Download className="size-4" />
              {busy === "custom" ? t("reports.hub.busy") : t("reports.custom.generate")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
