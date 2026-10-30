import { useCallback, useEffect, useMemo, useState } from "react";
import { eq, inArray } from "drizzle-orm";
import { Building2, ChevronDown, ChevronRight, Folder, FolderOpen, HardHat, Lock, RotateCcw, Search, Users } from "lucide-react";
import { db, schema } from "../../db";
import { callSharePoint, clearShareFlags, setShareFlags } from "@/lib/sharepoint";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { DOC_LEVELS, levelFlags, levelOf, shareFlags, type DocFlags, type DocLevel } from "@/lib/doc-rights";
import type { Client, SharePointShare, User } from "@/lib/types";
import { useSpTree, type Crumb, type SpRoot } from "@/components/project/useSpTree";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Flags = DocFlags;
type Grantee = { key: string; clientId: number; userId: number | null; label: string; sub?: string };
const NONE: Flags = { can_view: false, can_upload: false, can_edit: false };
const asFlags = shareFlags;
const LEVEL_LABEL: Record<DocLevel, MessageKey> = { none: "pda.lvl.none", view: "pda.lvl.view", contribute: "pda.lvl.contribute", full: "pda.lvl.full" };

/**
 * Who sees what, folder by folder. Pick a folder on the left; on the right, choose a level for each employee, each client
 * company and each of its users: no access, view only, view and upload, or full access (download, change, delete).
 * Nobody has any access until it is given here. A subfolder inherits from the folder above until something is set on it.
 *
 * Rights belong to the SharePoint folder itself, so they are the same here, in the library's Documentation page and in a
 * project's Documentation: set once, they apply everywhere that folder is reached.
 */
export function DocsAccess({
  root,
  color,
  clients,
  rootLabel,
}: {
  root: SpRoot;
  color: string;
  clients: Client[];
  rootLabel: string;
}) {
  const { t, tr } = useI18n();
  const tree = useSpTree(root);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [users, setUsers] = useState<(User & { clientId: number })[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [userDialog, setUserDialog] = useState<number | null>(null);
  const [who, setWho] = useState<"staff" | "clients">("staff");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentId = trail[trail.length - 1]?.id ?? root.id;
  /** The folders above this root, up to the library: rights set there reach down into this tree. */
  const [above, setAbove] = useState<string[]>([]);

  const loadShares = useCallback(async () => {
    setShares((await db.select().from(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.folder_id, 0))) as SharePointShare[]);
  }, []);

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
      setStaff(((await db.select().from(schema.users)) as User[]).filter((u) => u.user_type === "internal" && u.is_active === 1 && u.is_admin !== 1));
      await loadShares();
    })();
    void tree.list(root.id).catch((err) => setError(tr(err, "sp.error.failed")));
    if (root.id) {
      void callSharePoint<{ chain: string[] }>("chain", { driveId: root.drive, itemId: root.id })
        .then((out) => setAbove(out.chain.filter((id) => id !== root.id)))
        .catch(() => setAbove([]));
    } else setAbove([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIds, root.id]);

  const visibleClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .filter((c) => !q || c.company_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [clients, query]);

  const visibleStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, query]);

  /** The folder and its ancestors, nearest first, up to the whole library. */
  const chain: Crumb[] = [
    ...[{ id: root.id, name: root.name }, ...trail].reverse(),
    ...above.map((id) => ({ id, name: t("pda.above") })),
    ...(root.id ? [{ id: "", name: t("sp.wholeLibrary") }] : []),
  ];

  const explicitAt = (nodeId: string, g: Grantee) =>
    shares.find((s) => s.client_id === g.clientId && (s.user_id ?? null) === g.userId && s.folder_id === 0 && (s.item_id || "") === nodeId) ?? null;

  /** What this grantee has on the current folder, and where it comes from. */
  function resolve(g: Grantee): { flags: Flags; from: "here" | "above" | "none"; fromName?: string } {
    for (const node of chain) {
      const row = explicitAt(node.id, g);
      if (row) return { flags: asFlags(row), from: node.id === currentId ? "here" : "above", fromName: node.name };
    }
    return { flags: NONE, from: "none" };
  }

  async function change(g: Grantee, level: DocLevel) {
    setError(null);
    try {
      await setShareFlags({ folderId: 0, clientId: g.clientId, userId: g.userId, itemId: currentId, flags: levelFlags(level) });
      await loadShares();
    } catch (err) {
      setError(tr(err, "sp.error.failed"));
    }
  }

  async function reset(g: Grantee) {
    await clearShareFlags({ folderId: 0, clientId: g.clientId, userId: g.userId, itemId: currentId });
    await loadShares();
  }

  const hasRules = (nodeId: string) => shares.some((s) => s.folder_id === 0 && (s.item_id || "") === nodeId);

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
  const rank = (l: DocLevel) => DOC_LEVELS.indexOf(l);
  /** What a company has here: its users can never have more than this. */
  const companyLevel = (clientId: number) => levelOf(resolve({ key: "c", clientId, userId: null, label: "" }).flags);
  /** `max`: the most this grantee can be given (a client user: what their company has). */
  const rowFor = (g: Grantee, max?: DocLevel) => {
    const r = resolve(g);
    const stored = levelOf(r.flags);
    const shown: DocLevel = max && rank(stored) > rank(max) ? max : stored;
    const clipped = shown !== stored;
    const mine = g.userId === null && g.clientId > 0 ? users.filter((u) => u.clientId === g.clientId) : [];
    return (
      <tr key={g.key}>
        <td className="py-3 pr-3">
          <div className="flex items-center gap-3">
            {g.clientId === 0 ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <HardHat className="size-4" />
              </span>
            ) : g.userId === null ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Building2 className="size-4" />
              </span>
            ) : (
              <UserAvatar name={g.label} size="md" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{g.label}</p>
                {mine.length ? (
                  <Button size="xs" variant="outline" onClick={() => setUserDialog(g.clientId)}>
                    <Users className="size-3.5" />
                    {t("pda.manageUsers", { n: mine.length })}
                  </Button>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{g.sub}</p>
              <p className={cn("text-[11px]", r.from === "here" ? "font-semibold" : "text-muted-foreground")} style={r.from === "here" ? { color } : undefined}>
                {r.from === "here" ? t("pda.setHere") : r.from === "above" ? t("pda.inherited", { name: r.fromName ?? "" }) : t("pda.none")}
                {clipped ? ` · ${t("pda.limitedByCompany")}` : ""}
              </p>
            </div>
          </div>
        </td>
        <td className="py-3 text-center">
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 max-w-full overflow-x-auto">
            {DOC_LEVELS.map((lv) => {
              const on = shown === lv;
              const blocked = Boolean(max) && rank(lv) > rank(max as DocLevel);
              return (
                <button
                  key={lv}
                  type="button"
                  aria-pressed={on}
                  disabled={blocked}
                  title={blocked ? t("pda.aboveCompany") : t(`${LEVEL_LABEL[lv]}.hint` as MessageKey)}
                  onClick={() => void change(g, lv)}
                  className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", on ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", blocked && "cursor-not-allowed opacity-35 hover:text-muted-foreground")}
                  style={on ? { background: lv === "none" ? "var(--card)" : `color-mix(in srgb, ${color} 26%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${lv === "none" ? "currentColor" : color} 40%, transparent)` } : undefined}
                >
                  {t(LEVEL_LABEL[lv])}
                </button>
              );
            })}
          </div>
        </td>
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

        <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t("pda.levelsHelp")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
            {(
              [
                ["staff", t("pda.staff"), HardHat, staff.length],
                ["clients", t("pda.clientsHead"), Building2, clients.length],
              ] as const
            ).map(([id, label, Icon, n]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setWho(id);
                  setQuery("");
                }}
                className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", who === id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                style={who === id ? { background: `color-mix(in srgb, ${color} 18%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
              >
                <Icon className="size-4" style={who === id ? { color } : undefined} />
                {label}
                <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input className="pl-9" value={query} placeholder={who === "staff" ? t("pda.searchStaff") : t("pda.searchClient")} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{who === "staff" ? t("pda.staffHelp", { folder: here.id === root.id ? rootLabel : here.name }) : t("pda.clientsHelp")}</p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium" />
                <th className="pb-2 text-center font-medium">{t("pda.level")}</th>
                <th className="w-10 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {who === "staff" ? visibleStaff.map((u) => rowFor({ key: `s${u.id}`, clientId: 0, userId: u.id, label: u.name, sub: u.title || u.email })) : null}
              {who === "clients" ? visibleClients.map((c) => rowFor({ key: `c${c.id}`, clientId: c.id, userId: null, label: c.company_name, sub: c.name })) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={userDialog !== null} onOpenChange={(o) => !o && setUserDialog(null)}>
        <DialogContent className="sm:max-w-3xl">
          {(() => {
            const client = clients.find((c) => c.id === userDialog);
            if (!client) return null;
            const max = companyLevel(client.id);
            const mine = users.filter((u) => u.clientId === client.id).sort((a, b) => a.name.localeCompare(b.name));
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Users className="size-5" style={{ color }} />
                    {t("pda.usersOf", { name: client.company_name })}
                  </DialogTitle>
                  <DialogDescription>{t("pda.usersHelp", { folder: here.id === root.id ? rootLabel : here.name, level: t(LEVEL_LABEL[max]) })}</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <Building2 className="size-4 text-primary" />
                  <span className="font-medium">{client.company_name}</span>
                  <span className="ml-auto rounded-md bg-card px-2 py-0.5 text-xs font-semibold shadow-sm">{t(LEVEL_LABEL[max])}</span>
                </div>
                <div className="max-h-[55vh] overflow-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <tbody className="divide-y">{mine.map((u) => rowFor({ key: `u${client.id}-${u.id}`, clientId: client.id, userId: u.id, label: u.name, sub: u.email }, max))}</tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
