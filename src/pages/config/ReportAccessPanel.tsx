import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, Users, X } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { REPORT_SECTIONS, STANDARD_REPORTS } from "@/lib/project-report";
import { addReportAccess, loadAllReportAccess, removeReportAccess, type Subject } from "@/lib/report-access";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Person = { id: number; name: string };

/**
 * Who may generate which report. By default nobody but administrators. A report can be given to a person or to a whole
 * group; the custom generator and each of its chapters are given the same way. Whatever is given, a person's report only
 * ever holds the projects and information they can already see.
 */
export function ReportAccessPanel() {
  const { t } = useI18n();
  const [access, setAccess] = useState<Record<string, Subject[]>>({});
  const [users, setUsers] = useState<Person[]>([]);
  const [groups, setGroups] = useState<Person[]>([]);

  const load = useCallback(async () => {
    await dbReady;
    const [rows, people, grp] = await Promise.all([
      loadAllReportAccess(),
      db.select({ id: schema.users.id, name: schema.users.name, user_type: schema.users.user_type, is_admin: schema.users.is_admin, is_active: schema.users.is_active }).from(schema.users),
      db.select({ id: schema.access_groups.id, name: schema.access_groups.name, audience: schema.access_groups.audience }).from(schema.access_groups),
    ]);
    setAccess(rows);
    setUsers(people.filter((p) => p.user_type === "internal" && p.is_active === 1 && p.is_admin !== 1).map((p) => ({ id: p.id, name: p.name })));
    setGroups(grp.filter((g) => g.audience !== "external").map((g) => ({ id: g.id, name: g.name })));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useMemo(() => {
    const u = new Map(users.map((p) => [p.id, p.name]));
    const g = new Map(groups.map((p) => [p.id, p.name]));
    return (s: Subject) => (s.type === "user" ? u.get(s.id) : g.get(s.id)) ?? `#${s.id}`;
  }, [users, groups]);

  async function add(key: string, value: string) {
    const [type, id] = value.split(":");
    await addReportAccess(key, { type: type === "group" ? "group" : "user", id: Number(id) });
    await load();
  }

  const row = (key: string, label: string, money = false) => {
    const given = access[key] ?? [];
    const free = [
      ...groups.filter((g) => !given.some((s) => s.type === "group" && s.id === g.id)).map((g) => ({ value: `group:${g.id}`, label: `${t("reportAccess.group")} · ${g.name}` })),
      ...users.filter((u) => !given.some((s) => s.type === "user" && s.id === u.id)).map((u) => ({ value: `user:${u.id}`, label: u.name })),
    ];
    return (
      <li key={key} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_220px]">
        <p className="flex items-center gap-2 text-sm font-medium">
          {label}
          {money ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">$</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2.5 py-1 text-xs font-medium">
            <Shield className="size-3" />
            {t("reportAccess.admins")}
          </span>
          {given.map((s) => (
            <span key={`${s.type}-${s.id}`} className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-2.5 text-xs">
              {s.type === "group" ? <Users className="size-3" /> : null}
              {nameOf(s)}
              <button type="button" aria-label={t("exp.delete")} className="rounded-full p-0.5 hover:bg-foreground/10" onClick={() => void removeReportAccess(key, s).then(load)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <Select value="" onValueChange={(v) => void add(key, v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("reportAccess.add")} />
          </SelectTrigger>
          <SelectContent>
            {free.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">—</div> : free.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
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
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t("reportAccess.intro")}</p>
      {block(t("reportAccess.standard"), t("reportAccess.standardHint"), STANDARD_REPORTS.map((r) => row(`report:${r.id}`, t(r.titleKey as MessageKey))))}
      {block(t("reportAccess.custom"), t("reportAccess.customHint"), row("report:custom", t("reports.tab.custom")))}
      {block(t("reportAccess.sections"), t("reportAccess.sectionsHint"), REPORT_SECTIONS.map((s) => row(`section:${s.id}`, t(s.labelKey as MessageKey), s.money)))}
    </div>
  );
}
