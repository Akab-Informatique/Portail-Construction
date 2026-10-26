import { useCallback, useEffect, useMemo, useState } from "react";
import { eq, inArray } from "drizzle-orm";
import { Building2, ChevronDown, ChevronRight, Folder, FolderOpen, Lock, RotateCcw, Search } from "lucide-react";
import { db, schema } from "../../db";
import { clearShareFlags, setShareFlags } from "@/lib/sharepoint";
import { useI18n } from "@/lib/i18n";
import type { Client, SharePointShare, User } from "@/lib/types";
import { useSpTree, type Crumb, type SpRoot } from "@/components/project/useSpTree";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Flags = { can_view: boolean; can_upload: boolean; can_edit: boolean };
type Grantee = { key: string; clientId: number; userId: number | null; label: string; sub?: string };
const NONE: Flags = { can_view: false, can_upload: false, can_edit: false };
const asFlags = (s: SharePointShare): Flags => ({ can_view: s.can_view === 1, can_upload: s.can_upload === 1, can_edit: s.can_edit === 1 });

/**
 * Who sees what, folder by folder. Pick a folder on the left; on the right, switch View / Upload / Edit for each client
 * company and for each of its users. A subfolder inherits from the folder above until something is set on it.
 *
 * `shareFolderId` is where the rights are stored: a project's folder row, or 0 for the whole library.
 */
export function DocsAccess({
  root,
  color,
  clients,
  shareFolderId,
  rootLabel,
}: {
  root: SpRoot;
  color: string;
  clients: Client[];
  shareFolderId: number;
  rootLabel: string;
}) {
  const { t, tr } = useI18n();
  const tree = useSpTree(root);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [users, setUsers] = useState<(User & { clientId: number })[]>([]);
  const [open, setOpen] = useState<Set<number>>(() => new Set(clients.length === 1 ? [clients[0].id] : []));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentId = trail[trail.length - 1]?.id ?? root.id;
  const itemIdOf = (id: string) => (id === root.id ? "" : id);

  const loadShares = useCallback(async () => {
    setShares((await db.select().from(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.folder_id, shareFolderId))) as SharePointShare[]);
  }, [shareFolderId]);

  const clientIds = clients.map((c) => c.id).join(",");
  useEffect(() => {
    void (async () => {
      const ids = clients.map((c) => c.id);
      if (ids.length) {
        const links = await db.select().from(schema.client_users).where(inArray(schema.client_users.client_id, ids));
        const userIds = links.map((l) => l.user_id);
        const rows = userIds.length ? ((await db.select().from(schema.users).where(inArray(schema.users.id, userIds))) as User[]) : [];
        setUsers(links.flatMap((l) => (rows.find((u) => u.id === l.user_id) ? [{ ...rows.find((u) => u.id === l.user_id)!, clientId: l.client_id }] : [])));
      }
      await loadShares();
    })();
    void tree.list(root.id).catch((err) => setError(tr(err, "sp.error.failed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIds, root.id, shareFolderId]);

  const visibleClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => !q || c.company_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [clients, query]);

  /** The folder and its ancestors, nearest first. */
  const chain: Crumb[] = [...[{ id: root.id, name: root.name }, ...trail].reverse()];

  const explicitAt = (nodeId: string, g: Grantee) =>
    shares.find((s) => s.client_id === g.clientId && (s.user_id ?? null) === g.userId && (s.item_id || root.id) === nodeId) ?? null;

  /** What this grantee has on the current folder, and where it comes from. */
  function resolve(g: Grantee): { flags: Flags; from: "here" | "above" | "none"; fromName?: string } {
    for (const node of chain) {
      const row = explicitAt(node.id, g);
      if (row) return { flags: asFlags(row), from: node.id === currentId ? "here" : "above", fromName: node.name };
    }
    return { flags: NONE, from: "none" };
  }

  async function change(g: Grantee, key: keyof Flags, on: boolean) {
    const base = { ...resolve(g).flags };
    base[key] = on;
    if (key === "can_view" && !on) {
      base.can_upload = false;
      base.can_edit = false;
    }
    if (key !== "can_view" && on) base.can_view = true;
    setError(null);
    try {
      await setShareFlags({ folderId: shareFolderId, clientId: g.clientId, userId: g.userId, itemId: itemIdOf(currentId), flags: base });
      await loadShares();
    } catch (err) {
      setError(tr(err, "sp.error.failed"));
    }
  }

  async function reset(g: Grantee) {
    await clearShareFlags({ folderId: shareFolderId, clientId: g.clientId, userId: g.userId, itemId: itemIdOf(currentId) });
    await loadShares();
  }

  const hasRules = (nodeId: string) => shares.some((s) => (s.item_id || root.id) === nodeId && (s.can_view === 1 || s.can_upload === 1 || s.can_edit === 1));

  function renderNode(node: Crumb, path: Crumb[], depth: number) {
    const isOpen = tree.expanded.has(node.id);
    const active = node.id === currentId;
    return (
      <div key={node.id || "root"}>
        <div
          className={cn("flex items-center gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors", active ? "font-semibold" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")}
          style={{ paddingLeft: 6 + depth * 14, ...(active ? { background: `color-mix(in srgb, ${color} 16%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : {}) }}
        >
          <button type="button" aria-label={isOpen ? "−" : "+"} className="flex size-5 items-center justify-center rounded hover:bg-foreground/10" onClick={() => void tree.toggle(node.id)}>
            {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setTrail(path)}>
            {isOpen || active ? <FolderOpen className="size-4 shrink-0" style={{ color }} /> : <Folder className="size-4 shrink-0" style={{ color }} />}
            <span className="truncate">{node.name}</span>
            {hasRules(node.id) ? <Lock className="ml-auto size-3 shrink-0 opacity-60" /> : null}
          </button>
        </div>
        {isOpen ? tree.subfolders(node.id).map((k) => renderNode({ id: k.id, name: k.name }, [...path, { id: k.id, name: k.name }], depth + 1)) : null}
      </div>
    );
  }

  const here = chain[0];
  const rowFor = (g: Grantee, indent = false) => {
    const r = resolve(g);
    const company = g.userId !== null ? resolve({ ...g, userId: null, key: "c" }) : null;
    return (
      <tr key={g.key}>
        <td className={cn("py-3 pr-3", indent && "pl-8")}>
          <div className="flex items-center gap-3">
            {g.userId === null ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Building2 className="size-4" />
              </span>
            ) : (
              <UserAvatar name={g.label} size="md" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{g.label}</p>
              <p className="truncate text-xs text-muted-foreground">{g.sub}</p>
              <p className={cn("text-[11px]", r.from === "here" ? "font-semibold" : "text-muted-foreground")} style={r.from === "here" ? { color } : undefined}>
                {r.from === "here" ? t("pda.setHere") : r.from === "above" ? t("pda.inherited", { name: r.fromName ?? "" }) : t("pda.none")}
                {company && company.flags.can_view && !r.flags.can_view ? ` · ${t("pda.viaCompany")}` : ""}
              </p>
            </div>
          </div>
        </td>
        {(["can_view", "can_upload", "can_edit"] as const).map((k) => (
          <td key={k} className="py-3 text-center">
            <Switch checked={r.flags[k]} onCheckedChange={(on) => void change(g, k, on)} aria-label={`${g.label} ${k}`} />
          </td>
        ))}
        <td className="py-3 text-right">
          {r.from === "here" ? (
            <Button size="icon-sm" variant="ghost" title={t("pda.reset")} aria-label={t("pda.reset")} onClick={() => void reset(g)}>
              <RotateCcw className="size-4" />
            </Button>
          ) : null}
        </td>
      </tr>
    );
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <Card className="gap-1 p-2 lg:max-h-[66vh] lg:overflow-y-auto">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("pdoc.folders")}</p>
        {renderNode({ id: root.id, name: rootLabel }, [], 0)}
      </Card>

      <Card className="gap-4 p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("pda.rightsFor")}</p>
          <p className="font-display text-2xl leading-tight tracking-wide">{here.id === root.id ? rootLabel : here.name}</p>
          {trail.length > 0 ? <p className="text-xs text-muted-foreground">{[rootLabel, ...trail.map((c) => c.name)].join(" / ")}</p> : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {clients.length > 6 ? (
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input className="pl-9" value={query} placeholder={t("pda.searchClient")} onChange={(e) => setQuery(e.target.value)} />
          </div>
        ) : null}

        {clients.length === 0 ? <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t("pda.noClients")}</p> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium" />
                <th className="w-20 pb-2 text-center font-medium">{t("pda.view")}</th>
                <th className="w-20 pb-2 text-center font-medium">{t("pda.upload")}</th>
                <th className="w-20 pb-2 text-center font-medium">{t("pda.edit")}</th>
                <th className="w-10 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleClients.map((c) => {
                const mine = users.filter((u) => u.clientId === c.id);
                const isOpen = open.has(c.id);
                return [
                  rowFor({ key: `c${c.id}`, clientId: c.id, userId: null, label: c.company_name, sub: mine.length ? t("pda.users", { n: mine.length }) : t("pda.company") }),
                  ...(mine.length
                    ? [
                        <tr key={`t${c.id}`}>
                          <td colSpan={5} className="py-0">
                            <button
                              type="button"
                              className="flex items-center gap-1 pl-8 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                              onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                            >
                              <ChevronDown className={cn("size-3.5 transition-transform", !isOpen && "-rotate-90")} />
                              {t("pda.userRights")}
                            </button>
                          </td>
                        </tr>,
                      ]
                    : []),
                  ...(isOpen ? mine.map((u) => rowFor({ key: `u${c.id}-${u.id}`, clientId: c.id, userId: u.id, label: u.name, sub: u.email }, true)) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
