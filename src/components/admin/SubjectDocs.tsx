import { useCallback, useEffect, useMemo, useState } from "react";
import { eq } from "drizzle-orm";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Library, Lock, RotateCcw } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { clearDocLevel, setDocLevel, type DocSubject } from "@/lib/admin-access";
import { DOC_LEVELS, levelOf, shareFlags, type DocLevel } from "@/lib/doc-rights";
import { getSharePointSettings } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";
import type { SharePointSettings, SharePointShare } from "@/lib/types";
import { useSpTree, type SpRoot } from "@/components/project/useSpTree";
import { LevelSelect } from "@/components/admin/parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const same = (s: SharePointShare, subject: DocSubject) =>
  s.folder_id === 0 && s.client_id === subject.clientId && (s.user_id ?? null) === subject.userId && (s.group_id ?? null) === (subject.groupId ?? null);

/**
 * One person's, company's or group's level on every folder, in one tree. A folder with nothing set inherits from the folder
 * above (the nearest one that is set decides); a client user is never above their company, so their level is capped by it.
 * These are the same rights as the Documentation page's: set once, they apply wherever the folder is reached.
 */
export function SubjectDocs({ subject, cap }: { subject: DocSubject; /** The company a client user belongs to: its level on a folder is the most this user can have. */ cap?: DocSubject }) {
  const { t, tr } = useI18n();
  const [settings, setSettings] = useState<SharePointSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSharePointSettings()
      .then(setSettings)
      .finally(() => setReady(true));
  }, []);

  const root = useMemo<SpRoot | null>(() => (settings ? { id: "", name: settings.library_name || "SharePoint", drive: settings.drive_id, rowId: 0 } : null), [settings]);
  const tree = useSpTree(root);

  const loadShares = useCallback(async () => {
    await dbReady;
    setShares((await db.select().from(schema.sharepoint_shares).where(eq(schema.sharepoint_shares.folder_id, 0))) as SharePointShare[]);
  }, []);
  useEffect(() => {
    void loadShares();
  }, [loadShares]);
  useEffect(() => {
    if (root) void tree.list("").catch((err) => setError(tr(err, "sp.error.failed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const configured = Boolean(settings && settings.tenant_id && settings.client_id && settings.site_url);
  if (!ready) return <Card className="p-8 text-center text-sm text-muted-foreground">…</Card>;
  if (!configured || !root) return <Card className="p-8 text-center text-sm text-muted-foreground">{t("sp.notConfiguredHint")}</Card>;

  /** The nearest level set on this folder or above, for a grantee. */
  const resolve = (who: DocSubject, chain: string[]): { level: DocLevel; from: "here" | "above" | "none" } => {
    for (let i = 0; i < chain.length; i += 1) {
      const row = shares.find((s) => same(s, who) && (s.item_id || "") === chain[i]);
      if (row) return { level: levelOf(shareFlags(row)), from: i === 0 ? "here" : "above" };
    }
    return { level: "none", from: "none" };
  };

  async function change(nodeId: string, level: DocLevel) {
    setError(null);
    try {
      await setDocLevel(subject, nodeId, level);
      await loadShares();
    } catch (err) {
      setError(tr(err, "sp.error.failed"));
    }
  }

  async function reset(nodeId: string) {
    await clearDocLevel(subject, nodeId);
    await loadShares();
  }

  const hasRule = (nodeId: string) => shares.some((s) => same(s, subject) && (s.item_id || "") === nodeId);

  function node(id: string, name: string, ancestors: string[], depth: number) {
    const chain = [id, ...ancestors];
    const mine = resolve(subject, chain);
    const company = cap ? resolve(cap, chain).level : undefined;
    const shown: DocLevel = company && DOC_LEVELS.indexOf(mine.level) > DOC_LEVELS.indexOf(company) ? company : mine.level;
    const open = tree.expanded.has(id);
    const kids = tree.subfolders(id);
    const isRoot = id === "";
    return (
      <div key={id || "root"}>
        <div className="flex flex-wrap items-center gap-2 rounded-lg py-1.5 pr-2 text-sm hover:bg-foreground/[0.03]" style={{ paddingLeft: 6 + depth * 16 }}>
          <button type="button" aria-label={open ? "−" : "+"} className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-foreground/10" onClick={() => void tree.toggle(id)}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {isRoot ? <Library className="size-4 shrink-0 text-primary" /> : open ? <FolderOpen className="size-4 shrink-0 text-primary" /> : <Folder className="size-4 shrink-0 text-primary" />}
          <span className={cn("min-w-0 flex-1 truncate", isRoot && "font-semibold")}>{isRoot ? t("sp.wholeLibrary") : name}</span>
          {hasRule(id) ? <Lock className="size-3 shrink-0 opacity-60" /> : null}
          {cap && shown !== mine.level ? <span className="text-[10px] text-muted-foreground">{t("pda.limitedByCompany")}</span> : null}
          <LevelSelect size="sm" value={shown} inherited={mine.from !== "here"} max={company} onChange={(lv) => void change(id, lv)} />
          <span className="flex w-7 shrink-0 justify-end">
            {mine.from === "here" ? (
              <Button size="icon-sm" variant="ghost" title={t("pda.reset")} aria-label={t("pda.reset")} onClick={() => void reset(id)}>
                <RotateCcw className="size-3.5" />
              </Button>
            ) : null}
          </span>
        </div>
        {open ? kids.map((k) => node(k.id, k.name, chain, depth + 1)) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t("adm.docsTreeHelp")}</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card className="gap-0.5 p-2">{node("", "", [], 0)}</Card>
    </div>
  );
}

