import { useEffect, useMemo, useState } from "react";
import { Check, EyeOff, FileText, FolderKanban, LayoutDashboard, Presentation, ReceiptText } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { MENU_MODULES, OTHER_MODULES } from "@/lib/constants";
import type { Flags } from "@/lib/admin-access";
import { DOC_LEVELS, levelOf, shareFlags, type DocLevel } from "@/lib/doc-rights";
import { loadAllReportAccess } from "@/lib/report-access";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import type { SharePointShare } from "@/lib/types";
import { LEVEL_LABEL } from "@/components/admin/parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  staff: boolean;
  personId: number;
  clientIds: number[];
  groupIds: number[];
  /** What the person has by themselves, and what their groups add, per module. */
  ownFlags: Record<string, Flags>;
  inherited: Record<string, Flags>;
  projectCount: number | "all";
  projectTotal: number;
  goto: (tab: "menu" | "projects" | "docs" | "reports") => void;
};

const merge = (a?: Flags, b?: Flags): Flags => ({
  can_view: Boolean(a?.can_view || b?.can_view),
  can_create: Boolean(a?.can_create || b?.can_create),
  can_edit: Boolean(a?.can_edit || b?.can_edit),
  can_delete: Boolean(a?.can_delete || b?.can_delete),
});

/**
 * "What this person gets", in plain words: the sidebar they will see (staff) or the fixed client sidebar, how many projects,
 * their level on the documentation and how many reports. It reads the same rules the portal applies, so what is shown here is
 * what the person experiences.
 */
export function AccessSummary({ staff, personId, clientIds, groupIds, ownFlags, inherited, projectCount, projectTotal, goto }: Props) {
  const { t } = useI18n();
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [reports, setReports] = useState(0);

  useEffect(() => {
    void (async () => {
      await dbReady;
      setShares((await db.select().from(schema.sharepoint_shares)) as SharePointShare[]);
      if (staff) {
        const all = await loadAllReportAccess();
        setReports(Object.values(all).filter((list) => list.some((s) => (s.type === "user" && s.id === personId) || (s.type === "group" && groupIds.includes(s.id)))).length);
      }
    })();
  }, [staff, personId, groupIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const flags = (id: string) => merge(ownFlags[id], inherited[id]);
  /** The same rule the sidebar applies: the section must be open, and the item itself. */
  const visible = (id: string) => {
    const m = MENU_MODULES.find((x) => x.id === id);
    return Boolean(m && flags(id).can_view && (!m.parent || flags(m.parent).can_view));
  };
  const sections = MENU_MODULES.filter((m) => !m.parent);
  const label = (m: { id: string; labelKey?: string }) => (m.labelKey ? t(m.labelKey as MessageKey) : t(`module.${m.id}` as MessageKey));

  const docs = useMemo(() => {
    const owners = staff ? [0] : clientIds;
    const mine = shares.filter((s) => s.folder_id === 0 && ((s.user_id === personId && owners.includes(s.client_id)) || (s.group_id && groupIds.includes(s.group_id))));
    const root = mine.filter((s) => !s.item_id);
    const flagsAt = root.reduce((acc, s) => ({ can_view: acc.can_view || s.can_view === 1, can_upload: acc.can_upload || s.can_upload === 1, can_edit: acc.can_edit || s.can_edit === 1 }), shareFlags({ can_view: 0, can_upload: 0, can_edit: 0 } as SharePointShare));
    const folders = new Set(mine.filter((s) => s.item_id).map((s) => s.item_id));
    return { level: levelOf(flagsAt) as DocLevel, folders: folders.size };
  }, [shares, staff, personId, clientIds.join(","), groupIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientSidebar: [string, typeof LayoutDashboard][] = [
    [t("nav.dashboard"), LayoutDashboard],
    [t("nav.documents"), FileText],
    [t("nav.allProjects"), FolderKanban],
    [t("nav.clientBilling"), ReceiptText],
  ];
  const projectModules = OTHER_MODULES.filter((m) => m.scope === "project");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="gap-3 p-5">
        <div>
          <p className="text-sm font-semibold">{t("adm.sum.sidebar")}</p>
          <p className="text-xs text-muted-foreground">{t(staff ? "adm.sum.sidebarStaff" : "adm.sum.sidebarClient")}</p>
        </div>
        {staff ? (
          <ul className="space-y-2 rounded-xl bg-sidebar p-3 text-sm text-white">
            {sections.map((sec) => {
              const items = MENU_MODULES.filter((m) => m.parent === sec.id);
              return (
                <li key={sec.id}>
                  <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", visible(sec.id) ? "text-primary" : "text-white/30 line-through")}>{label(sec)}</p>
                  <ul className="mt-1 space-y-0.5">
                    {items.map((m) => {
                      const on = visible(m.id);
                      return (
                        <li key={m.id} className={cn("flex items-center gap-2 rounded px-2 py-1", on ? "bg-white/[0.06]" : "text-white/30")}>
                          {on ? <Check className="size-3.5 text-primary" /> : <EyeOff className="size-3.5" />}
                          <span className={cn(!on && "line-through")}>{label(m)}</span>
                          {on && flags(m.id).can_edit ? <span className="ml-auto text-[10px] text-white/50">{t("adm.sum.canEdit")}</span> : on ? <span className="ml-auto text-[10px] text-white/50">{t("adm.sum.viewOnly")}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="space-y-1 rounded-xl bg-sidebar p-3 text-sm text-white">
            {clientSidebar.map(([text, Icon]) => (
              <li key={text} className="flex items-center gap-2 rounded bg-white/[0.06] px-2 py-1">
                <Icon className="size-3.5 text-primary" />
                {text}
              </li>
            ))}
          </ul>
        )}
        {!staff ? <p className="text-xs text-muted-foreground">{t("adm.sum.clientNever")}</p> : null}
        {staff ? (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => goto("menu")}>
            {t("adm.sum.change")}
          </Button>
        ) : null}
        {staff ? (
          <p className="text-xs text-muted-foreground">
            {t("adm.sum.inProject")}: {projectModules.filter((m) => flags(m.id).can_view).map((m) => t(`module.${m.id}` as MessageKey)).join(", ") || "—"}
          </p>
        ) : null}
      </Card>

      <div className="grid content-start gap-4">
        <Card className="gap-2 p-5">
          <p className="text-sm font-semibold">{t("adm.tab.projects")}</p>
          <p className="font-display text-3xl leading-none">{projectCount === "all" ? t("adm.sum.allProjects") : `${projectCount} / ${projectTotal}`}</p>
          <p className="text-xs text-muted-foreground">{t(staff ? "adm.sum.projectsStaff" : "adm.sum.projectsClient")}</p>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => goto("projects")}>
            {t("adm.sum.change")}
          </Button>
        </Card>
        <Card className="gap-2 p-5">
          <p className="text-sm font-semibold">{t("adm.tab.docs")}</p>
          <p className="font-display text-3xl leading-none">{t(LEVEL_LABEL[docs.level])}</p>
          <p className="text-xs text-muted-foreground">{t("adm.sum.docsLine", { n: docs.folders, levels: DOC_LEVELS.length - 1 })}</p>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => goto("docs")}>
            {t("adm.sum.change")}
          </Button>
        </Card>
        {staff ? (
          <Card className="gap-2 p-5">
            <p className="text-sm font-semibold">{t("adm.tab.reports")}</p>
            <p className="font-display flex items-center gap-2 text-3xl leading-none">
              <Presentation className="size-6 text-primary" />
              {reports}
            </p>
            <p className="text-xs text-muted-foreground">{t("adm.sum.reportsLine")}</p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => goto("reports")}>
              {t("adm.sum.change")}
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
