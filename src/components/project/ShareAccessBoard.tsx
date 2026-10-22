import { useEffect, useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { loadAllFolders, loadFolderShares, shareFor, upsertShare } from "@/lib/sharepoint";
import { getSharePointSettings, sharepointReady } from "@/lib/settings";
import type { SharePointFolder, SharePointSettings, SharePointShare } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FolderTreePanel, type BrowseFolder } from "@/components/project/FolderTreePanel";

export function ShareAccessBoard() {
  const { t } = useI18n();
  const { clients } = useWorkspace();
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [folders, setFolders] = useState<SharePointFolder[]>([]);
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [active, setActive] = useState<BrowseFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientQuery, setClientQuery] = useState("");

  const libraryRoot: BrowseFolder | null = settings
    ? { id: 0, name: t("sp.wholeLibrary"), sp_item_id: "", sp_drive_id: settings.drive_id, path: "/" }
    : null;

  async function refreshShares() {
    const nextFolders = await loadAllFolders();
    setFolders(nextFolders);
    setShares(await loadFolderShares(nextFolders.map((f) => f.id)));
  }

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getSharePointSettings();
        setSettings(cfg);
        if (!sharepointReady(cfg)) return;
        const nextFolders = await loadAllFolders();
        setFolders(nextFolders);
        setShares(await loadFolderShares(nextFolders.map((f) => f.id)));
        setActive({
          id: 0,
          name: t("sp.wholeLibrary"),
          sp_item_id: "",
          sp_drive_id: cfg.drive_id,
          path: "/",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "SharePoint error");
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  async function setFlags(
    folderId: number,
    clientId: number,
    key: "can_view" | "can_upload" | "can_edit",
    on: boolean,
    current: SharePointShare | null,
  ) {
    const next = {
      can_view: key === "can_view" ? on : Boolean(current?.can_view) || on,
      can_upload: key === "can_upload" ? on : Boolean(current?.can_upload),
      can_edit: key === "can_edit" ? on : Boolean(current?.can_edit),
    };
    if (next.can_upload || next.can_edit) next.can_view = true;
    if (!on && key === "can_view") {
      next.can_upload = false;
      next.can_edit = false;
    }
    await upsertShare(folderId, clientId, next, "");
    await refreshShares();
  }

  async function clearFlags(folderId: number, clientId: number) {
    await upsertShare(folderId, clientId, { can_view: false, can_upload: false, can_edit: false }, "");
    await refreshShares();
  }

  const nav: BrowseFolder[] = libraryRoot ? [libraryRoot, ...folders] : folders;
  const shareCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const folder of nav) {
      counts[`${folder.id}`] = clients.filter((c) => Boolean(shareFor(shares, folder.id, c.id, "")?.can_view)).length;
    }
    return counts;
  }, [nav, clients, shares]);
  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.company_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [clients, clientQuery]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("sp.loading")}</p>;
  if (!settings || !sharepointReady(settings)) {
    return (
      <EmptyState
        icon={<FileText className="size-5" />}
        title={t("sp.notConfigured")}
        description={t("sp.notConfiguredHint")}
      />
    );
  }

  const accessFolderId = active?.id ?? 0;
  const sharedClients = clients.filter((c) => Boolean(shareFor(shares, accessFolderId, c.id, "")?.can_view));

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="gap-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("sp.folders")}</p>
        </div>
        <FolderTreePanel
          folders={nav}
          driveId={settings.drive_id}
          currentKey={active?.sp_item_id || `db-${active?.id ?? 0}`}
          shareCounts={shareCounts}
          onOpen={(folder) => setActive(folder)}
        />
      </Card>

      <Card className="gap-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("sp.accessPanel")}</p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">{active?.name ?? t("sp.wholeLibrary")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("sp.accessThisFolder")} · {t("sp.sharedWith", { n: sharedClients.length })}
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {sharedClients.length ? (
          <div className="flex flex-wrap gap-2">
            {sharedClients.map((c) => (
              <Badge key={c.id} variant="secondary">
                {c.company_name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("sp.noFoldersClient")}</p>
        )}
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder={t("sp.searchClients")} />
        </div>
        {filteredClients.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sp.noClients")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {filteredClients.map((c) => {
              const share = shareFor(shares, accessFolderId, c.id, "");
              return (
                <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.company_name}</p>
                    <p className="text-xs text-muted-foreground">{c.name}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    {(
                      [
                        ["can_view", t("sp.canView")],
                        ["can_upload", t("sp.canUpload")],
                        ["can_edit", t("sp.canEdit")],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs">
                        {label}
                        <Switch
                          checked={Boolean(share?.[key])}
                          onCheckedChange={(on) => {
                            void setFlags(accessFolderId, c.id, key, on, share);
                          }}
                        />
                      </label>
                    ))}
                    {share?.can_view ? (
                      <Button size="sm" variant="ghost" onClick={() => void clearFlags(accessFolderId, c.id)}>
                        {t("sp.clearAccess")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
