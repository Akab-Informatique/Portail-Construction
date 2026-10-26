import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, FolderOpen, KeyRound } from "lucide-react";
import { loadProjectFolders } from "@/lib/sharepoint";
import { getSharePointSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { projectColor } from "@/lib/project-colors";
import type { SharePointFolder, SharePointSettings } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { DocsAccess } from "@/components/project/DocsAccess";
import { DocsExplorer } from "@/components/project/DocsExplorer";
import type { SpRoot } from "@/components/project/useSpTree";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

/**
 * Documentation. Two tabs: the files (a tree on the left, a file explorer in the middle) and, for administrators,
 * who can see what. The project's SharePoint folder is the root and nothing above it can be reached.
 */
export function ProjectDocuments({ project, client }: SectionProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const color = projectColor(project);
  const isAdmin = Boolean(user?.is_admin) && user?.view_as !== "client";
  const tab = isAdmin && params.get("tab") === "access" ? "access" : "files";
  const [state, setState] = useState<"loading" | "notConfigured" | "noFolder" | "ready">("loading");
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [root, setRoot] = useState<SpRoot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSharePointSettings();
      if (cancelled) return;
      setSettings(s);
      if (!s.tenant_id || !s.client_id || !s.site_url) return setState("notConfigured");
      const rows = (await loadProjectFolders(project.id)) as SharePointFolder[];
      const first = [...rows].filter((r) => r.sp_item_id).sort((a, b) => a.id - b.id)[0];
      if (!first) return setState("noFolder");
      setRoot({ id: first.sp_item_id, name: first.name, drive: first.sp_drive_id || s.drive_id, rowId: first.id });
      setState("ready");
    })().catch(() => setState("noFolder"));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  if (state === "loading") return <Card className="p-10 text-center text-sm text-muted-foreground">…</Card>;
  if (state === "notConfigured") return <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />;
  if (state === "noFolder" || !root) return <EmptyState icon={<FolderOpen className="size-5" />} title={t("pdoc.noFolder")} description={t("pdoc.noFolderHint")} />;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="flex w-fit items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {(
            [
              ["files", t("pdoc.tabFiles"), FolderOpen],
              ["access", t("pdoc.tabAccess"), KeyRound],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setParams(id === "access" ? { tab: "access" } : {}, { replace: true })}
              className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", tab === id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              style={tab === id ? { background: `color-mix(in srgb, ${color} 18%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
            >
              <Icon className="size-4" style={tab === id ? { color } : undefined} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "access" ? (
        <DocsAccess root={root} color={color} clients={client ? [client] : []} shareFolderId={root.rowId} rootLabel={root.name} />
      ) : (
        <DocsExplorer root={root} settings={settings!} color={color} rootLabel={root.name} />
      )}
    </div>
  );
}
