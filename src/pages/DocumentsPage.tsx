import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, FolderOpen, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { getSharePointSettings } from "@/lib/settings";
import type { SharePointSettings } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { MemberDocs } from "@/components/project/MemberDocs";
import { DocsAccess } from "@/components/project/DocsAccess";
import { DocsExplorer } from "@/components/project/DocsExplorer";
import type { SpRoot } from "@/components/project/useSpTree";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BRAND = "#fbaa19";

/**
 * Administrators: the whole SharePoint library. A tree of folders on the left, the tools on top (upload, download,
 * export to PDF, print, selection) and the files in the middle, plus a tab to set, folder by folder, what each client
 * company and each of its users can see.
 */
function LibraryDocs() {
  const { t } = useI18n();
  const { clients } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "access" ? "access" : "files";
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getSharePointSettings()
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card className="p-10 text-center text-sm text-muted-foreground">…</Card>;
  if (!settings || !settings.tenant_id || !settings.client_id || !settings.site_url) {
    return <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />;
  }

  const label = settings.library_name || "SharePoint";
  // The root of the library: no item id, rights stored at library level (folder 0).
  const root: SpRoot = { id: "", name: label, drive: settings.drive_id, rowId: 0 };

  return (
    <div className="space-y-4">
      <div className="flex w-fit items-center gap-1 rounded-xl border bg-muted/40 p-1">
        {(
          [
            ["files", t("pdoc.tabFiles"), FolderOpen],
            ["access", t("pdoc.tabAccess"), KeyRound],
          ] as const
        ).map(([id, text, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setParams(id === "access" ? { tab: "access" } : {}, { replace: true })}
            className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", tab === id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            style={tab === id ? { background: `color-mix(in srgb, ${BRAND} 22%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${BRAND} 45%, transparent)` } : undefined}
          >
            <Icon className="size-4" style={tab === id ? { color: BRAND } : undefined} />
            {text}
          </button>
        ))}
      </div>
      {tab === "access" ? <DocsAccess root={root} color={BRAND} clients={clients} shareFolderId={0} rootLabel={label} /> : <DocsExplorer root={root} settings={settings} color={BRAND} rootLabel={label} />}
    </div>
  );
}

/** Chantier › Documentation: the company's SharePoint library. */
export function DocumentsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { projects, clientProjects, selectedClient } = useWorkspace();
  const asClient = user?.user_type === "external" || user?.view_as === "client";
  const isAdmin = Boolean(user?.is_admin) && !asClient;
  // Everyone but an administrator sees only the folders of their projects that an administrator gave them.
  const mine = asClient && selectedClient ? clientProjects : projects;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("nav.section.client")} title={t("nav.documents")} />
      {isAdmin ? <LibraryDocs /> : <MemberDocs projects={mine} />}
    </div>
  );
}
