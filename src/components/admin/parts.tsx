import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DOC_LEVELS, type DocLevel } from "@/lib/doc-rights";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import type { Client, Project } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const BRAND = "#fbaa19";
export const LEVEL_LABEL: Record<DocLevel, MessageKey> = { none: "pda.lvl.none", view: "pda.lvl.view", contribute: "pda.lvl.contribute", full: "pda.lvl.full" };
const rank = (l: DocLevel) => DOC_LEVELS.indexOf(l);

/** The four document levels as one segmented control. `max` greys out what is above it (a client user, capped by their company). */
export function LevelSelect({ value, onChange, max, inherited = false, size = "md" }: { value: DocLevel; onChange: (l: DocLevel) => void; max?: DocLevel; inherited?: boolean; size?: "sm" | "md" }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-0.5">
      {DOC_LEVELS.map((lv) => {
        const on = value === lv;
        const blocked = Boolean(max) && rank(lv) > rank(max as DocLevel);
        return (
          <button
            key={lv}
            type="button"
            aria-pressed={on}
            disabled={blocked}
            title={blocked ? t("pda.aboveCompany") : t(`${LEVEL_LABEL[lv]}.hint` as MessageKey)}
            onClick={() => onChange(lv)}
            className={cn(
              "rounded-md font-medium transition-colors",
              size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
              on ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              inherited && on && "opacity-60",
              blocked && "cursor-not-allowed opacity-35 hover:text-muted-foreground",
            )}
            style={on ? { background: lv === "none" ? "var(--card)" : `color-mix(in srgb, ${BRAND} 26%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${lv === "none" ? "currentColor" : BRAND} 40%, transparent)` } : undefined}
          >
            {t(LEVEL_LABEL[lv])}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Projects as checkboxes, grouped by company. `locked` are projects the person already gets another way (a group, a whole
 * company): shown ticked and cannot be unticked here. `companies` adds a "whole company" box above each company's projects.
 */
export function ProjectPicker({
  projects,
  clients,
  selected,
  onChange,
  locked = new Set<number>(),
  lockedNote,
  companies,
  onCompaniesChange,
  maxHeight = "max-h-72",
}: {
  projects: Project[];
  clients: Client[];
  selected: number[];
  onChange: (ids: number[]) => void;
  locked?: Set<number>;
  lockedNote?: string;
  companies?: number[];
  onCompaniesChange?: (ids: number[]) => void;
  maxHeight?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .map((c) => ({ client: c, items: projects.filter((p) => p.client_id === c.id && (!q || p.name.toLowerCase().includes(q) || c.company_name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.items.length > 0)
      .sort((a, b) => a.client.company_name.localeCompare(b.client.company_name));
  }, [projects, clients, query]);

  return (
    <div className="space-y-2">
      {projects.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input className="pl-9" value={query} placeholder={t("adm.searchProject")} onChange={(e) => setQuery(e.target.value)} />
        </div>
      ) : null}
      <div className={cn("overflow-y-auto rounded-lg border bg-card", maxHeight)}>
        {groups.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("adm.noProjects")}</p> : null}
        {groups.map(({ client, items }) => {
          const whole = companies?.includes(client.id) ?? false;
          return (
            <div key={client.id} className="border-b last:border-b-0">
              <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5">
                <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{client.company_name}</p>
                {onCompaniesChange ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium">
                    <Checkbox checked={whole} onCheckedChange={(v) => onCompaniesChange(v === true ? [...(companies ?? []), client.id] : (companies ?? []).filter((id) => id !== client.id))} />
                    {t("adm.wholeCompany")}
                  </label>
                ) : null}
              </div>
              <ul>
                {items.map((p) => {
                  const lockedHere = locked.has(p.id) || whole;
                  const on = lockedHere || selected.includes(p.id);
                  return (
                    <li key={p.id}>
                      <label className={cn("flex items-center gap-2.5 px-3 py-1.5 text-sm", lockedHere ? "cursor-default opacity-70" : "cursor-pointer hover:bg-muted/40")}>
                        <Checkbox checked={on} disabled={lockedHere} onCheckedChange={(v) => onChange(v === true ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {lockedHere ? <span className="shrink-0 text-[10px] text-muted-foreground">{whole ? t("adm.viaCompany") : (lockedNote ?? t("adm.viaGroup"))}</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
