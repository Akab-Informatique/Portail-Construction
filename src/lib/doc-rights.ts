import { useCallback, useEffect, useState } from "react";
import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { useAuth } from "./auth";
import { CLIENT_MARKER } from "./client-rights";
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

/**
 * The rights of the access groups a person belongs to, written as the person's own (an employee: client 0; a client user: each
 * of their companies), the widest where several overlap. The server does the same when it decides; this only drives what the screen shows.
 */
async function groupRightsOf(user: SessionUser, all: SharePointShare[]): Promise<SharePointShare[]> {
  const memberships = await db.select({ group_id: schema.user_access_groups.group_id }).from(schema.user_access_groups).where(eq(schema.user_access_groups.user_id, user.id));
  const mine = new Set(memberships.map((m) => m.group_id));
  const rows = all.filter((s) => s.group_id && mine.has(s.group_id));
  if (rows.length === 0) return [];
  const owners = user.user_type === "external" ? (await db.select({ client_id: schema.client_users.client_id }).from(schema.client_users).where(eq(schema.client_users.user_id, user.id))).map((l) => l.client_id) : [0];
  const merged = new Map<string, SharePointShare>();
  for (const row of rows) {
    for (const owner of owners) {
      const key = `${owner}|${row.item_id || ""}`;
      const prev = merged.get(key);
      merged.set(key, {
        ...row,
        id: -row.id,
        client_id: owner,
        user_id: user.id,
        group_id: null,
        can_view: Math.max(row.can_view, prev?.can_view ?? 0),
        can_upload: Math.max(row.can_upload, prev?.can_upload ?? 0),
        can_edit: Math.max(row.can_edit, prev?.can_edit ?? 0),
      });
    }
  }
  return [...merged.values()];
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
 * The level a person has on a SharePoint folder. Rights belong to the folder itself (its SharePoint item id; "" is the whole
 * library), so they are the same wherever the folder is reached from. `chain` is the folder and its ancestors, nearest
 * first, ending with "". For each grantee the nearest folder with a right set decides, so a subfolder can take rights away.
 */
export function levelAt(shares: SharePointShare[], subjects: Subject[], chain: string[]): DocLevel {
  const hitOf = (subject: Subject) => {
    const mine = shares.filter((s) => s.client_id === subject.clientId && (s.user_id ?? null) === subject.userId);
    const row = chain.map((key) => mine.find((s) => s.folder_id === 0 && (s.item_id || "") === key)).find(Boolean);
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
  // A company has no rights of its own: a client user has what was given to them (or their groups), like an employee.
  for (const subject of subjects.filter((x) => x.clientId > 0 && x.userId !== null)) {
    const hit = hitOf(subject);
    if (hit) add(hit);
  }
  return levelOf(flags);
}

/** Every folder this person was given something on (the whole library, "", excluded). */
export function sharedItems(shares: SharePointShare[], subjects: Subject[]): string[] {
  const ids = new Set<string>();
  for (const s of shares) {
    if (s.folder_id !== 0 || !s.item_id) continue;
    if (subjects.some((x) => x.clientId === s.client_id && x.userId === (s.user_id ?? null))) ids.add(s.item_id);
  }
  return [...ids];
}

/** The rights given to the signed-in person (or, for an administrator looking through someone's eyes, to that kind of person). */
export function useDocShares() {
  const { user, can, permissions } = useAuth();
  const { clients, selectedClient } = useWorkspace();
  const [shares, setShares] = useState<SharePointShare[]>([]);
  const [loading, setLoading] = useState(true);
  const subjectKey = JSON.stringify(subjectsFor(user, clients, selectedClient));

  const load = useCallback(async () => {
    await dbReady;
    const all = (await db.select().from(schema.sharepoint_shares)) as SharePointShare[];
    const mine = user && user.view_as !== "client" && !user.is_admin ? await groupRightsOf(user, all) : [];
    const base = all.filter((s) => !s.group_id);
    for (const g of mine) {
      const i = base.findIndex((s) => s.folder_id === 0 && s.client_id === g.client_id && s.user_id === g.user_id && (s.item_id || "") === (g.item_id || ""));
      // What is set for the person on a folder wins over their groups' level on that same folder.
      if (i < 0) base.push(g);
    }
    // A client whose pages and actions were set: Interact on Documentation lets them upload and download where they can view.
    const asClient = user && (user.user_type === "external" || user.view_as === "client") && !user.is_admin;
    if (asClient && can(CLIENT_MARKER, "view")) {
      const up = can("app_client_documents", "create");
      const full = can("app_client_documents", "edit");
      for (const row of base) {
        if (row.can_view !== 1) continue;
        if (up) row.can_upload = 1;
        if (full) row.can_edit = 1;
      }
    }
    setShares(base);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.view_as, permissions]);
  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load, user?.id, user?.view_as]);

  return { shares, loading, subjects: JSON.parse(subjectKey) as Subject[], reload: load };
}
