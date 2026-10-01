import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "frx.chunk-reload";

/**
 * Lazy-loads a page module exporting a named component. After a deploy, an open
 * tab may ask for a chunk that no longer exists; reload once to pick up the new
 * build instead of leaving a blank page.
 */
export function lazyPage<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
) {
  return lazy(async () => {
    try {
      const mod = await load();
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* storage unavailable */
      }
      return { default: mod[name] };
    } catch (err) {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
        if (!reloaded) sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        reloaded = true;
      }
      if (!reloaded) {
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw err;
    }
  });
}
