import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, FolderOpen, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { getSharePointSettings } from "@/lib/settings";
import type { SharePointFolder, SharePointSettings } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { SharePointLibrary } from "@/components/project/SharePointLibrary";
import { loadProjectFolders } from "@/lib/sharepoint";
import { projectColor } from "@/lib/project-colors";
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

/**
 * Employees: the SharePoint folders of the projects they are assigned to, one tab per project, in the same explorer as
 * the administrators. They can look, download, export and print; adding or deleting needs the right to create.
 */
function StaffDocs({ canWrite }: { canWrite: boolean }) {
  const { t } = useI18n();
  const { projects } = useWorkspace();
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [roots, setRoots] = useState<{ project: (typeof projects)[number]; root: SpRoot }[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const ids = projects.map((p) => p.id).join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getSharePointSettings();
      if (cancelled) return;
      setSettings(s);
      const found: { project: (typeof projects)[number]; root: SpRoot }[] = [];
      if (s.tenant_id && s.client_id && s.site_url) {
        for (const project of projects) {
          const rows = (await loadProjectFolders(project.id)) as SharePointFolder[];
          const first = [...rows].filter((r) => r.sp_item_id).sort((a, b) => a.id - b.id)[0];
          if (first) found.push({ project, root: { id: first.sp_item_id, name: first.name, drive: first.sp_drive_id || s.drive_id, rowId: first.id } });
        }
      }
      if (cancelled) return;
      setRoots(found);
      setPick((cur) => cur ?? found[0]?.project.id ?? null);
    })()
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (loading) return <Card className="p-10 text-center text-sm text-muted-foreground">…</Card>;
  if (!settings || !settings.tenant_id || !settings.client_id || !settings.site_url) {
    return <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />;
  }
  const current = roots.find((r) => r.project.id === pick) ?? roots[0];
  if (!current) return <EmptyState icon={<FolderOpen className="size-5" />} title={t("pdoc.noFolder")} description={t("pdoc.noFolderHint")} />;
  const color = projectColor(current.project);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {roots.map(({ project }) => {
          const c = projectColor(project);
          const active = project.id === current.project.id;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => setPick(project.id)}
              className={cn("flex h-9 max-w-xs items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all", active ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              style={active ? { background: `color-mix(in srgb, ${c} 18%, var(--card))`, borderColor: c } : undefined}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: c }} />
              <span className="truncate">{project.name}</span>
            </button>
          );
        })}
      </div>
      <DocsExplorer key={current.root.rowId} root={current.root} settings={settings} color={color} rootLabel={current.root.name} readOnly={!canWrite} />
    </div>
  );
}

/** Chantier › Documentation: the company's SharePoint library. */
export function DocumentsPage() {
  const { t } = useI18n();
  const { can, user } = useAuth();
  const { selectedClient } = useWorkspace();
  const asClient = user?.user_type === "external" || user?.view_as === "client";
  const isAdmin = Boolean(user?.is_admin) && !asClient;
  const canAdd = Boolean(user?.is_admin) || can("app_client_documents", "create");
  // Staff see the folders of the projects they are assigned to; a client account is limited to what was shared with its company.
  const forClient = asClient ? selectedClient : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("nav.section.client")} title={t("nav.documents")} />
      {isAdmin ? (
        <LibraryDocs />
      ) : (
        asClient ? (
          <SharePointLibrary projectId={0} projectName={t("nav.documents")} client={forClient} canCreate={canAdd} scopeProjectIds={undefined} />
        ) : (
          <StaffDocs canWrite={canAdd} />
        )
      )}
    </div>
  );
}
