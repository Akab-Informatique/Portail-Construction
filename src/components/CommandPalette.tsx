import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Building2, CornerDownLeft, FolderKanban, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useNavModel } from "./AppShell";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

type Entry = {
  key: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
};

/** Lowercase and strip accents so "electricite" finds "Électricité". */
function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Opens the palette on Ctrl+K / Cmd+K from anywhere in the app. */
export function useCommandPaletteHotkey(open: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

const MAX_PER_GROUP = 6;

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const sections = useNavModel();
  const { clients, projects, selectClient } = useWorkspace();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const go = (to: string) => () => {
      onOpenChange(false);
      navigate(to);
    };
    const pages: Entry[] = sections.flatMap((section) =>
      section.items.map((item) => ({
        key: `page:${section.id}:${item.id}`,
        group: t("nav.searchPages"),
        label: item.label,
        hint: section.context ? `${section.label} · ${section.context}` : section.label,
        icon: item.icon,
        run: go(item.to),
      })),
    );
    const clientEntries: Entry[] = clients.map((c) => ({
      key: `client:${c.id}`,
      group: t("nav.searchClients"),
      label: c.company_name,
      hint: c.name,
      icon: Building2,
      run: () => {
        selectClient(c.id);
        go(`/clients/${c.id}`)();
      },
    }));
    const clientName = new Map(clients.map((c) => [c.id, c.company_name]));
    const projectEntries: Entry[] = projects.map((p) => ({
      key: `project:${p.id}`,
      group: t("nav.searchProjects"),
      label: p.name,
      hint: [p.project_number, clientName.get(p.client_id)].filter(Boolean).join(" · "),
      icon: FolderKanban,
      run: go(`/projects/${p.id}`),
    }));
    return [...pages, ...clientEntries, ...projectEntries];
  }, [sections, clients, projects, t, navigate, onOpenChange, selectClient]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    const matched = q
      ? entries.filter((e) => normalize(`${e.label} ${e.hint ?? ""}`).includes(q))
      : entries.filter((e) => e.group === t("nav.searchPages"));
    const perGroup = new Map<string, number>();
    return matched.filter((e) => {
      const n = perGroup.get(e.group) ?? 0;
      perGroup.set(e.group, n + 1);
      return n < MAX_PER_GROUP;
    });
  }, [entries, query, t]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[cursor]?.run();
    }
  }

  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-md border p-0 sm:max-w-xl"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">{t("nav.search")}</DialogTitle>
        <DialogDescription className="sr-only">{t("nav.searchPlaceholder")}</DialogDescription>
        <div className="frx-beam h-1 w-full" aria-hidden />
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("nav.searchPlaceholder")}
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            aria-label={t("nav.searchPlaceholder")}
            role="combobox"
            aria-expanded
            aria-controls="frx-palette-list"
            aria-activedescendant={results[cursor] ? `frx-palette-${cursor}` : undefined}
          />
          <kbd className="frx-label rounded-[3px] border px-1.5 py-0.5 text-[9px] text-muted-foreground">Esc</kbd>
        </div>
        <div ref={listRef} id="frx-palette-list" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("nav.searchEmpty")}</p>
          ) : (
            results.map((entry, i) => {
              const header = entry.group !== lastGroup ? entry.group : null;
              lastGroup = entry.group;
              const Icon = entry.icon;
              const active = i === cursor;
              return (
                <div key={entry.key}>
                  {header ? <p className="frx-label px-3 pb-1.5 pt-3 text-muted-foreground first:pt-1">{header}</p> : null}
                  <button
                    type="button"
                    id={`frx-palette-${i}`}
                    role="option"
                    aria-selected={active}
                    data-index={i}
                    onMouseMove={() => setCursor(i)}
                    onClick={entry.run}
                    className={cn(
                      "relative flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors",
                      active
                        ? "bg-primary/15 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:bg-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{entry.label}</span>
                      {entry.hint ? (
                        <span className="block truncate text-[12px] text-muted-foreground">{entry.hint}</span>
                      ) : null}
                    </span>
                    {active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
