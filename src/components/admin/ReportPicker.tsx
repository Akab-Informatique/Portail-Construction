import { useCallback, useEffect, useState } from "react";
import { dbReady } from "../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { REPORT_SECTIONS, STANDARD_REPORTS } from "@/lib/project-report";
import { addReportAccess, loadAllReportAccess, removeReportAccess, type Subject } from "@/lib/report-access";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Which reports a person or a group may generate. A person also gets what their groups were given (shown ticked and locked).
 * Whatever is given, a report only ever holds the projects and information the person can already see.
 */
export function ReportPicker({ subject, viaGroups = [] }: { subject: Subject; viaGroups?: number[] }) {
  const { t } = useI18n();
  const [access, setAccess] = useState<Record<string, Subject[]>>({});

  const load = useCallback(async () => {
    await dbReady;
    setAccess(await loadAllReportAccess());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const row = (key: string, label: string, money = false) => {
    const given = access[key] ?? [];
    const own = given.some((s) => s.type === subject.type && s.id === subject.id);
    const via = !own && given.some((s) => s.type === "group" && viaGroups.includes(s.id));
    return (
      <li key={key}>
        <label className={via ? "flex cursor-default items-center gap-3 px-4 py-2.5 opacity-70" : "flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40"}>
          <Checkbox
            checked={own || via}
            disabled={via}
            onCheckedChange={(v) => void (v === true ? addReportAccess(key, subject) : removeReportAccess(key, subject)).then(load)}
          />
          <span className="flex-1 text-sm font-medium">{label}</span>
          {money ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">$</span> : null}
          {via ? <span className="text-[10px] text-muted-foreground">{t("adm.viaGroup")}</span> : null}
        </label>
      </li>
    );
  };

  const block = (title: string, hint: string, rows: React.ReactNode) => (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b bg-muted/30 px-4 py-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ul className="divide-y">{rows}</ul>
    </Card>
  );

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("reportAccess.intro")}</p>
      {block(t("reportAccess.standard"), t("reportAccess.standardHint"), STANDARD_REPORTS.map((r) => row(`report:${r.id}`, t(r.titleKey as MessageKey))))}
      {block(t("reportAccess.custom"), t("reportAccess.customHint"), row("report:custom", t("reports.tab.custom")))}
      {block(t("reportAccess.sections"), t("reportAccess.sectionsHint"), REPORT_SECTIONS.map((s) => row(`section:${s.id}`, t(s.labelKey as MessageKey), s.money)))}
    </div>
  );
}
