import { useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, Lock } from "lucide-react";
import { callSharePoint, loadProjectFolders } from "@/lib/sharepoint";
import { getSharePointSettings } from "@/lib/settings";
import { capsOf, entriesOf, levelAt, useDocShares } from "@/lib/doc-rights";
import { useI18n } from "@/lib/i18n";
import { projectColor } from "@/lib/project-colors";
import type { Project, SharePointFolder, SharePointSettings } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { DocsExplorer } from "@/components/project/DocsExplorer";
import type { SpRoot } from "@/components/project/useSpTree";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Space = { project: Project; root: SpRoot; entries: string[]; rootOpen: boolean };

/**
 * Documentation for everyone who is not an administrator, employees and client accounts alike: the SharePoint folders of
 * their projects, and only the ones an administrator gave them, at the level given (view; view and upload; full).
 */
export function MemberDocs({ projects }: { projects: Project[] }) {
  const { t } = useI18n();
  const { shares, subjects, loading: loadingShares } = useDocShares();
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [roots, setRoots] = useState<{ project: Project; root: SpRoot }[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [entryPick, setEntryPick] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const ids = projects.map((p) => p.id).join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getSharePointSettings();
      if (cancelled) return;
      setSettings(s);
      const found: { project: Project; root: SpRoot }[] = [];
      if (s.tenant_id && s.client_id && s.site_url) {
        for (const project of projects) {
          const rows = (await loadProjectFolders(project.id)) as SharePointFolder[];
          const first = [...rows].filter((r) => r.sp_item_id).sort((a, b) => a.id - b.id)[0];
          if (first) found.push({ project, root: { id: first.sp_item_id, name: first.name, drive: first.sp_drive_id || s.drive_id, rowId: first.id } });
        }
      }
      if (!cancelled) setRoots(found);
    })()
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const spaces: Space[] = useMemo(
    () =>
      roots
        .map(({ project, root }) => ({
          project,
          root,
          entries: entriesOf(shares, subjects, root.rowId),
          rootOpen: levelAt(shares, subjects, root.rowId, [""]) !== "none",
        }))
        .filter((s) => s.rootOpen || s.entries.length > 0),
    [roots, shares, subjects],
  );
  const current = spaces.find((s) => s.project.id === pick) ?? spaces[0];

  // When only a subfolder was given, the way in is a list of those folders: their names come from SharePoint.
  const wanted = current && !current.rootOpen ? current.entries : [];
  useEffect(() => {
    if (!current || wanted.length === 0) return;
    let cancelled = false;
    void Promise.all(
      wanted
        .filter((id) => !names[id])
        .map((id) =>
          callSharePoint<{ item: { name: string } }>("stat", { driveId: current.root.drive, itemId: id })
            .then((out) => [id, out.item.name] as const)
            .catch(() => [id, "—"] as const),
        ),
    ).then((pairs) => {
      if (!cancelled && pairs.length) setNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.project.id, wanted.join(",")]);

  if (loading || loadingShares) return <Card className="p-10 text-center text-sm text-muted-foreground">…</Card>;
  if (!settings || !settings.tenant_id || !settings.client_id || !settings.site_url) {
    return <EmptyState icon={<FileText className="size-5" />} title={t("sp.notConfigured")} description={t("sp.notConfiguredHint")} />;
  }
  if (roots.length === 0) return <EmptyState icon={<FolderOpen className="size-5" />} title={t("pdoc.noFolder")} description={t("pdoc.noFolderHint")} />;
  if (!current) return <EmptyState icon={<Lock className="size-5" />} title={t("pdoc.noAccess")} description={t("pdoc.noAccessHint")} />;

  const color = projectColor(current.project);
  const projectRootId = current.root.id;
  const caps = (chain: string[]) => capsOf(levelAt(shares, subjects, current.root.rowId, chain.map((k) => (k === projectRootId ? "" : k))));
  const entry = !current.rootOpen ? (current.entries.find((e) => e === entryPick) ?? current.entries[0]) : null;
  const root: SpRoot = entry ? { id: entry, name: names[entry] || "…", drive: current.root.drive, rowId: current.root.rowId } : current.root;

  return (
    <div className="space-y-4">
      {spaces.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {spaces.map(({ project }) => {
            const c = projectColor(project);
            const active = project.id === current.project.id;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setPick(project.id);
                  setEntryPick(null);
                }}
                className={cn("flex h-9 max-w-xs items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all", active ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                style={active ? { background: `color-mix(in srgb, ${c} 18%, var(--card))`, borderColor: c } : undefined}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: c }} />
                <span className="truncate">{project.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {!current.rootOpen && current.entries.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {current.entries.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setEntryPick(id)}
              className={cn("flex h-9 max-w-xs items-center gap-2 rounded-lg border px-3 text-sm font-medium", id === entry ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <FolderOpen className="size-4" style={{ color }} />
              <span className="truncate">{names[id] || "…"}</span>
            </button>
          ))}
        </div>
      ) : null}
      <DocsExplorer key={`${current.root.rowId}-${root.id}`} root={root} settings={settings} color={color} rootLabel={root.name} caps={caps} />
    </div>
  );
}
