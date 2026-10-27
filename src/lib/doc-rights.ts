import { useCallback, useEffect, useState } from "react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "./auth";
import { useWorkspace } from "./workspace";
import type { Client, SessionUser, SharePointShare } from "./types";

/**
 * Document rights come in three levels, and nobody has any until an administrator gives it (administrators have everything):
 *  - view: look at the files, nothing else (no download, no printing, no change, no upload);
 *  - contribute: look and add files or folders, but not download, change or delete;
 *  - full: view, download, print, change, delete.
 * They are stored in the three share flags: view; view + upload; view + upload + edit.
 */
export type DocLevel = "none" | "view" | "contribute" | "full";
export const DOC_LEVELS: DocLevel[] = ["none", "view", "contribute", "full"];
export type DocFlags = { can_view: boolean; can_upload: boolean; can_edit: boolean };
export type DocCaps = { view: boolean; upload: boolean; download: boolean; modify: boolean };

export const FULL_CAPS: DocCaps = { view: true, upload: true, download: true, modify: true };
const NO_CAPS: DocCaps = { view: false, upload: false, download: false, modify: false };

export function levelFlags(level: DocLevel): DocFlags {
  return {
    can_view: level !== "none",
    can_upload: level === "contribute" || level === "full",
    can_edit: level === "full",
  };
}

export function levelOf(flags: DocFlags): DocLevel {
  if (flags.can_edit) return "full";
  if (flags.can_upload) return "contribute";
  if (flags.can_view) return "view";
  return "none";
}

export function capsOf(level: DocLevel): DocCaps {
  if (level === "full") return FULL_CAPS;
  if (level === "contribute") return { view: true, upload: true, download: false, modify: false };
  if (level === "view") return { view: true, upload: false, download: false, modify: false };
  return NO_CAPS;
}

export const shareFlags = (s: SharePointShare): DocFlags => ({ can_view: s.can_view === 1, can_upload: s.can_upload === 1, can_edit: s.can_edit === 1 });

/** Who a right is given to: a client company (userId null), a client user, or an employee (clientId 0). */
export type Subject = { clientId: number; userId: number | null };

export function subjectsFor(user: SessionUser | null, clients: Client[], selectedClient: Client | null): Subject[] {
  if (!user) return [];
  if (user.view_as === "client") return selectedClient ? [{ clientId: selectedClient.id, userId: null }] : [];
  if (user.user_type === "external") return clients.flatMap((c) => [{ clientId: c.id, userId: null }, { clientId: c.id, userId: user.id }]);
  return [{ clientId: 0, userId: user.id }];
}

/**
 * The level a person has on a folder of one project. `chain` is the folder and its ancestors, nearest first, with the
 * project's own folder written as "". For each grantee the nearest folder with a right set decides, so a subfolder can
 * take rights away; the grantees' rights add up.
 */
export function levelAt(shares: SharePointShare[], subjects: Subject[], rowId: number, chain: string[]): DocLevel {
  const hitOf = (subject: Subject) => {
    const mine = shares.filter((s) => s.client_id === subject.clientId && (s.user_id ?? null) === subject.userId);
    const row = [...chain.map((key) => mine.find((s) => s.folder_id === rowId && (s.item_id || "") === key)), mine.find((s) => s.folder_id === 0 && !s.item_id)].find(Boolean);
    return row ? shareFlags(row) : null;
  };
  const none: DocFlags = { can_view: false, can_upload: false, can_edit: false };
  let flags = none;
  const add = (f: DocFlags) => {
    flags = { can_view: flags.can_view || f.can_view, can_upload: flags.can_upload || f.can_upload, can_edit: flags.can_edit || f.can_edit };
  };
  for (const subject of subjects.filter((x) => x.clientId === 0)) {
    const hit = hitOf(subject);
    if (hit) add(hit);
  }
  // A client user's right is set inside their company's: it can lower it, never go above it.
  for (const clientId of new Set(subjects.filter((x) => x.clientId > 0).map((x) => x.clientId))) {
    const company = hitOf({ clientId, userId: null }) ?? none;
    const mine = subjects.find((x) => x.clientId === clientId && x.userId !== null);
    const own = mine ? hitOf(mine) : null;
    if (!own) {
      add(company);
      continue;
    }
    add(levelFlags(DOC_LEVELS[Math.min(DOC_LEVELS.indexOf(levelOf(own)), DOC_LEVELS.indexOf(levelOf(company)))]));
  }
  return levelOf(flags);
}

/** Folders deeper than the project's own that were given to this person: their way in when the project folder itself was not. */
export function entriesOf(shares: SharePointShare[], subjects: Subject[], rowId: number): string[] {
  const ids = new Set<string>();
  for (const s of shares) {
    if (s.folder_id !== rowId || !s.item_id) continue;
    if (!subjects.some((x) => x.clientId === s.client_id && x.userId === (s.user_id ?? null))) continue;
    if (levelAt(shares, subjects, rowId, [s.item_id]) !== "none") ids.add(s.item_id);
  }
  return [...ids];
}

/** The rights given to the signed-in person (or, for an administrator looking through someone's eyes, to that kind of person). */
export function useDocShares() {
  const { user } = useAuth();
  const { clients, selectedClient } = useWorkspace();
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [loading, setLoading] = useState(true);
  const subjectKey = JSON.stringify(subjectsFor(user, clients, selectedClient));

  const load = useCallback(async () => {
    await dbReady;
    setShares((await db.select().from(schema.sharepoint_shares)) as SharePointShare[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load, user?.id, user?.view_as]);

  return { shares, loading, subjects: JSON.parse(subjectKey) as Subject[], reload: load };
}
