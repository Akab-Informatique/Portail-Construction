import { addonsOf, versionsOf } from "./billing-files";
import type { BillingFile } from "./types";

export type TreeRow = {
  file: BillingFile;
  /** 0 = the quote, 1 = its newer versions, 2 = add-ons under a final newer version. */
  level: number;
  /** Has rows underneath it that can be folded away. */
  hasChildren: boolean;
};

/**
 * The rows to show for one quote, as a foldable tree:
 *   1487                 (level 0, folds everything below)
 *     1487-1             (level 1)
 *     1487-2  final      (level 1, folds its add-ons)
 *       + 1487-A1        (level 2: one more indent than the final version)
 * When the original quote itself is the final one, its add-ons sit directly under it.
 */
export function quoteRows(root: BillingFile, all: BillingFile[], collapsed: Set<number>): TreeRow[] {
  const versions = versionsOf(root, all);
  const addons = addonsOf(root, all);
  const finalVersion = versions.find((v) => v.is_final === 1);
  const rows: TreeRow[] = [];

  const rootHasChildren = versions.length > 1 || (finalVersion?.id === root.id && addons.length > 0) || (!finalVersion && addons.length > 0);
  rows.push({ file: root, level: 0, hasChildren: rootHasChildren });
  if (collapsed.has(root.id)) return rows;

  const pushAddons = (level: number) => addons.forEach((a) => rows.push({ file: a, level, hasChildren: false }));

  if (finalVersion?.id === root.id) pushAddons(1);

  for (const version of versions.slice(1)) {
    const holdsAddons = finalVersion?.id === version.id && addons.length > 0;
    rows.push({ file: version, level: 1, hasChildren: holdsAddons });
    if (holdsAddons && !collapsed.has(version.id)) pushAddons(2);
  }

  // Add-ons without a final version should not exist, but never hide them.
  if (!finalVersion) pushAddons(1);
  return rows;
}
