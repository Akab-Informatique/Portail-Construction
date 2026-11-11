import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drafts: what is typed in a note box is kept in this browser as it is typed, so closing the tab or window,
 * a crash or a refresh loses nothing. The draft is dropped once the text is sent (set it back to empty).
 */
const PREFIX = "frx.draft.";

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable: the box still works, it just is not kept */
  }
}

/** A text kept as a draft under `key` (null: not kept). Same shape as useState. */
export function useDraft(key: string | null): [string, (value: string) => void] {
  const [value, setValue] = useState(() => (key ? readDraft(key) : ""));
  const keyRef = useRef(key);
  // Another box (another task, another note): load its own draft.
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(key ? readDraft(key) : "");
    }
  }, [key]);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      if (key) writeDraft(key, next);
    },
    [key],
  );
  return [value, set];
}

/** Several drafts of the same kind, one per id (for example one reply box under each note). */
export function useDraftMap(prefix: string): [(id: number | string) => string, (id: number | string, value: string) => void] {
  const [, bump] = useState(0);
  const cache = useRef<Record<string, string>>({});
  const get = (id: number | string) => {
    const k = `${prefix}:${id}`;
    if (!(k in cache.current)) cache.current[k] = readDraft(k);
    return cache.current[k];
  };
  const set = (id: number | string, value: string) => {
    const k = `${prefix}:${id}`;
    cache.current[k] = value;
    writeDraft(k, value);
    bump((n) => n + 1);
  };
  return [get, set];
}
