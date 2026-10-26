import { useCallback, useState } from "react";
import { callSharePoint, type SpItem } from "@/lib/sharepoint";

export type SpRoot = { id: string; name: string; drive: string; /** The folder row of this project in the portal's database. */ rowId: number };
export type Crumb = { id: string; name: string };

/** Folder contents of a SharePoint tree, loaded on demand and remembered. Shared by the file view and the access view. */
export function useSpTree(root: SpRoot | null) {
  const [cache, setCache] = useState<Record<string, SpItem[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(root ? [root.id] : []));

  const list = useCallback(
    async (folderId: string, force = false) => {
      if (!root) return [] as SpItem[];
      if (!force && cache[folderId]) return cache[folderId];
      const data = await callSharePoint<{ items: SpItem[] }>("list", { driveId: root.drive, itemId: folderId });
      setCache((prev) => ({ ...prev, [folderId]: data.items }));
      return data.items;
    },
    [root, cache],
  );

  const toggle = useCallback(
    async (id: string) => {
      const open = expanded.has(id);
      if (!open) await list(id).catch(() => undefined);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [expanded, list],
  );

  const open = useCallback((id: string) => setExpanded((prev) => new Set(prev).add(id)), []);
  const subfolders = (id: string) => (cache[id] ?? []).filter((i) => i.isFolder).sort((a, b) => a.name.localeCompare(b.name));

  return { cache, expanded, list, toggle, open, subfolders };
}
