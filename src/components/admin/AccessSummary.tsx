import { useEffect, useMemo, useState } from "react";
import { Check, FileText, FolderKanban, LayoutDashboard, ReceiptText, X } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { MENU_MODULES, OTHER_MODULES } from "@/lib/constants";
import { callSharePoint } from "@/lib/sharepoint";
import { DOC_LEVELS, levelOf, type DocLevel } from "@/lib/doc-rights";
import { loadAllReportAccess } from "@/lib/report-access";
import { REPORT_SECTIONS, STANDARD_REPORTS } from "@/lib/project-report";
import { getSharePointSettings } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import type { AccessGroup, AccessGroupPermission, Client, GroupProject, Permission, Project, SharePointShare, User } from "@/lib/types";
import { LEVEL_LABEL } from "@/components/admin/parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  staff: boolean;
  person: User;
  clientIds: number[];
  groups: AccessGroup[];
  myGroupIds: number[];
  groupPerms: AccessGroupPermission[];
  userPerms: Permission[];
  groupProjects: GroupProject[];
  members: { project_id: number; user_id: number }[];
  userClients: { user_id: number; client_id: number }[];
  projects: Project[];
  clients: Client[];
  goto: (tab: "menu" | "projects" | "docs" | "reports" | "groups") => void;
};

type Flags = { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };
const NONE: Flags = { can_view: false, can_create: false, can_edit: false, can_delete: false };
const fromRow = (r: { can_view: number; can_create: number; can_edit: number; can_delete: number }): Flags => ({ can_view: r.can_view === 1, can_create: r.can_create === 1, can_edit: r.can_edit === 1, can_delete: r.can_delete === 1 });
const or = (a: Flags, b: Flags): Flags => ({ can_view: a.can_view || b.can_view, can_create: a.can_create || b.can_create, can_edit: a.can_edit || b.can_edit, can_delete: a.can_delete || b.can_delete });

const SOURCE = "rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground";

/**
 * The exact rights this person has, written out: every page and what they can do in it, every project, every folder and
 * the reports, each with where it comes from (given to them, or by which group). Nothing is summarised away.
 */
export function AccessSummary(p: Props) {
  const { t } = useI18n();
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reportAccess, setReportAccess] = useState<Record<string, { type: string; id: number }[]>>({});
  const groupName = (id: number) => p.groups.find((g) => g.id === id)?.name ?? `#${id}`;
  const label = (m: { id: string; labelKey?: string }) => (m.labelKey ? t(m.labelKey as MessageKey) : t(`module.${m.id}` as MessageKey));

  useEffect(() => {
    void (async () => {
      await dbReady;
      setShares((await db.select().from(schema.sharepoint_shares)) as SharePointShare[]);
      if (p.staff) setReportAccess(await loadAllReportAccess());
    })();
  }, [p.person.id, p.staff]);

  // ---- pages and actions (staff)
  const pages = useMemo(() => {
    const rows = [...MENU_MODULES, ...OTHER_MODULES].map((m) => {
      const own = p.userPerms.find((x) => x.user_id === p.person.id && x.module === m.id && x.scope_type === "global");
      const via = p.myGroupIds.flatMap((gid) => {
        const r = p.groupPerms.find((x) => x.group_id === gid && x.module === m.id);
        return r ? [{ group: groupName(gid), flags: fromRow(r) }] : [];
      });
      const flags = via.reduce((acc, v) => or(acc, v.flags), own ? fromRow(own) : NONE);
      const sources = [...(own && fromRow(own).can_view ? [t("adm.sum.personal")] : []), ...via.filter((v) => v.flags.can_view).map((v) => v.group)];
      return { m, flags, sources };
    });
    // a page needs its section open too, exactly as the sidebar decides
    const view = (id: string) => rows.find((r) => r.m.id === id)?.flags.can_view ?? false;
    return rows.map((r) => ({ ...r, open: r.flags.can_view && (!r.m.parent || view(r.m.parent)) }));
  }, [p.userPerms, p.groupPerms, p.myGroupIds.join(","), p.person.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPages = pages.filter((r) => r.open && r.m.group === "menu" && r.m.parent);
  const closedPages = pages.filter((r) => !r.open && r.m.group === "menu" && r.m.parent);
  const projectModules = pages.filter((r) => r.m.group !== "menu" && r.m.scope === "project" && r.flags.can_view);

  // ---- projects
  const everything = p.staff && p.person.all_clients !== 0;
  const projectRows = useMemo(() => {
    const myCompanies = p.userClients.filter((u) => u.user_id === p.person.id).map((u) => u.client_id);
    const scope = p.staff ? p.projects : p.projects.filter((x) => p.clientIds.includes(x.client_id));
    return scope.flatMap((proj) => {
      const sources: string[] = [];
      if (p.members.some((m) => m.user_id === p.person.id && m.project_id === proj.id)) sources.push(t("adm.sum.personal"));
      if (p.staff && myCompanies.includes(proj.client_id)) sources.push(t("adm.sum.company"));
      for (const gid of p.myGroupIds) if (p.groupProjects.some((g) => g.group_id === gid && g.project_id === proj.id)) sources.push(groupName(gid));
      return sources.length ? [{ proj, sources }] : [];
    });
  }, [p.projects, p.members, p.userClients, p.groupProjects, p.myGroupIds.join(","), p.person.id, p.staff, p.clientIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- documentation
  const docs = useMemo(() => {
    const owners = p.staff ? [0] : p.clientIds;
    const mine = shares.filter((s) => s.folder_id === 0 && ((s.user_id === p.person.id && owners.includes(s.client_id)) || (s.group_id && p.myGroupIds.includes(s.group_id))));
    const byItem = new Map<string, { flags: { can_view: boolean; can_upload: boolean; can_edit: boolean }; sources: string[] }>();
    for (const s of mine) {
      const key = s.item_id || "";
      const cur = byItem.get(key) ?? { flags: { can_view: false, can_upload: false, can_edit: false }, sources: [] };
      cur.flags = { can_view: cur.flags.can_view || s.can_view === 1, can_upload: cur.flags.can_upload || s.can_upload === 1, can_edit: cur.flags.can_edit || s.can_edit === 1 };
      cur.sources.push(s.group_id ? groupName(s.group_id) : t("adm.sum.personal"));
      byItem.set(key, cur);
    }
    return [...byItem].map(([item, v]) => ({ item, level: levelOf(v.flags) as DocLevel, sources: [...new Set(v.sources)] })).sort((a, b) => (a.item === "" ? -1 : b.item === "" ? 1 : 0));
  }, [shares, p.person.id, p.staff, p.clientIds.join(","), p.myGroupIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // folder names come from SharePoint
  const itemKey = docs.map((d) => d.item).join(",");
  useEffect(() => {
    const ids = docs.map((d) => d.item).filter((id) => id && !names[id]);
    if (!ids.length) return;
    void (async () => {
      const settings = await getSharePointSettings().catch(() => null);
      if (!settings?.drive_id) return;
      const found: Record<string, string> = {};
      await Promise.all(
        ids.slice(0, 40).map(async (id) => {
          try {
            const out = await callSharePoint<{ item: { name: string } }>("stat", { driveId: settings.drive_id, itemId: id });
            found[id] = out.item.name;
          } catch {
            /* name unknown: the id is shown */
          }
        }),
      );
      setNames((prev) => ({ ...prev, ...found }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  // ---- reports (staff)
  const reportRows = useMemo(() => {
    const all = [
      ...STANDARD_REPORTS.map((r) => ({ key: `report:${r.id}`, label: t(r.titleKey as MessageKey) })),
      { key: "report:custom", label: t("reports.tab.custom") },
      ...REPORT_SECTIONS.map((s) => ({ key: `section:${s.id}`, label: t(s.labelKey as MessageKey) })),
    ];
    return all.flatMap((r) => {
      const given = reportAccess[r.key] ?? [];
      const sources = [...(given.some((s) => s.type === "user" && s.id === p.person.id) ? [t("adm.sum.personal")] : []), ...given.filter((s) => s.type === "group" && p.myGroupIds.includes(s.id)).map((s) => groupName(s.id))];
      return sources.length ? [{ ...r, sources }] : [];
    });
  }, [reportAccess, p.person.id, p.myGroupIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientSidebar: [string, typeof LayoutDashboard][] = [
    [t("nav.dashboard"), LayoutDashboard],
    [t("nav.documents"), FileText],
    [t("nav.allProjects"), FolderKanban],
    [t("nav.clientBilling"), ReceiptText],
  ];

  const Section = ({ title, hint, tab, children }: { title: string; hint: string; tab: "menu" | "projects" | "docs" | "reports" | "groups"; children: React.ReactNode }) => (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => p.goto(tab)}>
          {t("adm.sum.change")}
        </Button>
      </div>
      {children}
    </Card>
  );
  const chips = (sources: string[]) => sources.map((s) => <span key={s} className={SOURCE}>{s}</span>);
  const empty = (text: string) => <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">{text}</p>;

  return (
    <div className="grid gap-4">
      <Section title={t("adm.sum.groupsTitle")} hint={t("adm.sum.groupsHint")} tab="groups">
        {p.myGroupIds.length ? <div className="flex flex-wrap gap-1.5">{p.myGroupIds.map((g) => <span key={g} className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium">{groupName(g)}</span>)}</div> : empty(t("adm.sum.noGroups"))}
      </Section>

      {p.staff ? (
        <Section title={t("adm.sum.pagesTitle")} hint={t("adm.sum.pagesHint")} tab="menu">
          {openPages.length ? (
            <ul className="divide-y rounded-lg border">
              {openPages.map(({ m, flags, sources }) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Check className="size-4 shrink-0 text-emerald-600" />
                  <span className="min-w-36 flex-1 font-medium">{label(m)}</span>
                  <span className="flex flex-wrap gap-1">
                    {(
                      [
                        ["can_view", "people.col.view"],
                        ["can_create", "people.col.create"],
                        ["can_edit", "people.col.edit"],
                        ["can_delete", "people.col.delete"],
                      ] as const
                    ).map(([k, l]) => (
                      <span key={k} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", flags[k] ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground/50 line-through")}>
                        {t(l as MessageKey)}
                      </span>
                    ))}
                  </span>
                  <span className="flex flex-wrap gap-1">{chips(sources)}</span>
                </li>
              ))}
            </ul>
          ) : (
            empty(t("adm.sum.noPages"))
          )}
          {closedPages.length ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <X className="size-3.5" />
              {t("adm.sum.hidden")}: {closedPages.map((r) => label(r.m)).join(", ")}
            </p>
          ) : null}
          {projectModules.length ? (
            <p className="text-xs text-muted-foreground">
              {t("adm.sum.inProject")}: {projectModules.map((r) => label(r.m)).join(", ")}
            </p>
          ) : null}
        </Section>
      ) : (
        <Card className="gap-3 p-5">
          <p className="text-sm font-semibold uppercase tracking-wide">{t("adm.sum.pagesTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("adm.sum.sidebarClient")}</p>
          <ul className="divide-y rounded-lg border">
            {clientSidebar.map(([text, Icon]) => (
              <li key={text} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Check className="size-4 text-emerald-600" />
                <Icon className="size-4 text-muted-foreground" />
                {text}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("adm.sum.clientNever")}</p>
        </Card>
      )}

      <Section title={t("adm.tab.projects")} hint={t(p.staff ? "adm.sum.projectsStaff" : "adm.sum.projectsClient")} tab="projects">
        {everything ? (
          <p className="rounded-lg bg-primary/10 px-3 py-3 text-sm font-medium">{t("adm.sum.allProjects")}</p>
        ) : projectRows.length ? (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {projectRows.map(({ proj, sources }) => (
              <li key={proj.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                <Check className="size-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">{proj.name}</span>
                <span className="text-[11px] text-muted-foreground">{p.clients.find((c) => c.id === proj.client_id)?.company_name}</span>
                {chips(sources)}
              </li>
            ))}
          </ul>
        ) : (
          empty(t("adm.sum.noProjects"))
        )}
      </Section>

      <Section title={t("adm.tab.docs")} hint={t("adm.sum.docsHint")} tab="docs">
        {docs.length ? (
          <ul className="divide-y rounded-lg border">
            {docs.map((d) => (
              <li key={d.item || "root"} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{d.item === "" ? t("sp.wholeLibrary") : (names[d.item] ?? `${t("adm.sum.folder")} …${d.item.slice(-6)}`)}</span>
                <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", d.level === "none" ? "bg-muted text-muted-foreground" : "bg-primary/15")} title={t(`${LEVEL_LABEL[d.level]}.hint` as MessageKey)}>
                  {t(LEVEL_LABEL[d.level])}
                </span>
                {chips(d.sources)}
              </li>
            ))}
          </ul>
        ) : (
          empty(t("adm.sum.noDocs"))
        )}
        <p className="text-xs text-muted-foreground">{t("adm.sum.docsRule", { n: DOC_LEVELS.length - 1 })}</p>
      </Section>

      {p.staff ? (
        <Section title={t("adm.tab.reports")} hint={t("adm.sum.reportsLine")} tab="reports">
          {reportRows.length ? (
            <ul className="divide-y rounded-lg border">
              {reportRows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                  <Check className="size-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {chips(r.sources)}
                </li>
              ))}
            </ul>
          ) : (
            empty(t("adm.sum.noReports"))
          )}
        </Section>
      ) : null}
    </div>
  );
}
