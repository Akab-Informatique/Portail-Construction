import { useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { MENU_MODULES, MODULES, OTHER_MODULES, type ModuleDef } from "@/lib/constants";
import { CLIENT_PROJECT_MODULES, CLIENT_SECTIONS } from "@/lib/client-rights";
import type { Flags } from "@/lib/admin-access";
import { NO_FLAGS } from "@/lib/admin-access";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const FULL: Flags = { can_view: true, can_create: true, can_edit: true, can_delete: true };
const VIEW: Flags = { can_view: true, can_create: false, can_edit: false, can_delete: false };

type Level = "none" | "view" | "interact" | "custom";
const levelOf = (f: Flags): Level => {
  if (!f.can_view) return "none";
  if (f.can_create && f.can_edit && f.can_delete) return "interact";
  if (!f.can_create && !f.can_edit && !f.can_delete) return "view";
  return "custom";
};
const merge = (a: Flags, b: Flags): Flags => ({
  can_view: a.can_view || b.can_view,
  can_create: a.can_create || b.can_create,
  can_edit: a.can_edit || b.can_edit,
  can_delete: a.can_delete || b.can_delete,
});

/**
 * The sidebar and the project modules as switches. Each sidebar section (01, 02, 03…) has one switch that opens or closes
 * it; each page inside has three steps: Hidden, View, or Interact (add, change, delete), with a detail row for anything in
 * between. `inherited` is what the groups already give: shown and locked, so what is personal is clear.
 */
export function PermMatrix({
  flags,
  inherited,
  onChange,
  variant = "staff",
}: {
  flags: Record<string, Flags>;
  inherited?: Record<string, Flags>;
  onChange: (module: string, next: Flags) => void;
  /** "client": the client sidebar (01 Overview, 02 Your company, 03 Accounting) and the modules a client can be given in a project. */
  variant?: "staff" | "client";
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<string | null>(null);
  const label = (m: ModuleDef) => (m.labelKey ? t(m.labelKey as MessageKey) : t(`module.${m.id}` as MessageKey));
  const own = (id: string) => flags[id] ?? NO_FLAGS;
  const via = (id: string) => inherited?.[id] ?? NO_FLAGS;
  const eff = (id: string) => merge(own(id), via(id));

  const defOf = (id: string) => MODULES.find((m) => m.id === id) as ModuleDef;
  const client = variant === "client";
  const sectionList: { sec: ModuleDef; title: string; items: ModuleDef[] }[] = client
    ? CLIENT_SECTIONS.map((c) => ({ sec: defOf(c.id), title: t(c.labelKey as MessageKey), items: c.items.map(defOf) }))
    : MENU_MODULES.filter((m) => !m.parent).map((sec) => ({ sec, title: label(sec), items: MENU_MODULES.filter((m) => m.parent === sec.id) }));
  const projectMods = client ? CLIENT_PROJECT_MODULES.map(defOf) : OTHER_MODULES.filter((m) => m.scope === "project");
  const otherMods = client ? [] : OTHER_MODULES.filter((m) => m.scope !== "project");

  const stepper = (m: ModuleDef, disabled = false) => {
    const f = eff(m.id);
    const cur = levelOf(f);
    const lockedView = via(m.id).can_view;
    const steps: { id: Level; text: string; apply: Flags }[] = [
      { id: "none", text: t("adm.perm.none"), apply: NO_FLAGS },
      { id: "view", text: t("adm.perm.view"), apply: VIEW },
      { id: "interact", text: t("adm.perm.interact"), apply: FULL },
    ];
    return (
      <div className="flex items-center gap-1.5">
        <div className={cn("inline-flex rounded-lg border bg-muted/40 p-0.5", disabled && "pointer-events-none opacity-40")}>
          {steps.map((s) => {
            const on = cur === s.id;
            const blocked = s.id === "none" && lockedView;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                disabled={blocked}
                title={blocked ? t("adm.viaGroup") : undefined}
                onClick={() => onChange(m.id, s.apply)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                  on ? (s.id === "none" ? "bg-card text-foreground shadow-sm" : s.id === "view" ? "bg-sky-500/20 text-sky-800 shadow-sm dark:text-sky-200" : "bg-primary text-primary-foreground shadow-sm") : "text-muted-foreground hover:text-foreground",
                  blocked && "cursor-not-allowed opacity-40",
                )}
              >
                {s.text}
              </button>
            );
          })}
          {cur === "custom" ? <span className="rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">{t("adm.perm.custom")}</span> : null}
        </div>
        <button type="button" aria-label={t("adm.perm.detail")} title={t("adm.perm.detail")} onClick={() => setDetail(detail === m.id ? null : m.id)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          {detail === m.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        {lockedView ? <Lock className="size-3 text-muted-foreground" aria-label={t("adm.viaGroup")} /> : null}
      </div>
    );
  };

  const detailRow = (m: ModuleDef) =>
    detail === m.id ? (
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t bg-muted/30 px-4 py-2 text-xs">
        {(
          [
            ["can_view", "people.col.view"],
            ["can_create", "people.col.create"],
            ["can_edit", "people.col.edit"],
            ["can_delete", "people.col.delete"],
          ] as const
        ).map(([k, l]) => {
          const locked = !own(m.id)[k] && via(m.id)[k];
          return (
            <label key={k} className="flex items-center gap-1.5">
              <Checkbox
                checked={own(m.id)[k] || via(m.id)[k]}
                disabled={locked}
                onCheckedChange={(v) => {
                  const next = { ...own(m.id), [k]: v === true };
                  if (k !== "can_view" && v === true) next.can_view = true;
                  if (k === "can_view" && v !== true) Object.assign(next, NO_FLAGS);
                  onChange(m.id, next);
                }}
              />
              {t(l as MessageKey)}
            </label>
          );
        })}
      </div>
    ) : null;

  const row = (m: ModuleDef, disabled = false) => (
    <li key={m.id} className="border-t first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{label(m)}</p>
          {m.scope === "project" && t(`module.${m.id}.desc` as MessageKey) ? <p className="text-xs text-muted-foreground">{t(`module.${m.id}.desc` as MessageKey)}</p> : null}
        </div>
        {stepper(m, disabled)}
      </div>
      {detailRow(m)}
    </li>
  );

  return (
    <div className="grid gap-4">
      {sectionList.map(({ sec, title, items }, i) => {
        const open = eff(sec.id).can_view;
        const lockedOpen = via(sec.id).can_view;
        return (
          <section key={sec.id} className={cn("overflow-hidden rounded-xl border bg-card", !open && "opacity-90")}>
            <header className="flex items-center gap-3 border-b bg-[#141414] px-4 py-2.5 text-white">
              <span className="font-display text-xl leading-none text-primary">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 font-display text-lg uppercase tracking-wide">{title}</span>
              <span className="text-[11px] uppercase tracking-wider text-white/60">{open ? t("adm.perm.sectionOn") : t("adm.perm.sectionOff")}</span>
              <Switch
                checked={open}
                disabled={lockedOpen}
                title={lockedOpen ? t("adm.viaGroup") : undefined}
                onCheckedChange={(v) => onChange(sec.id, v ? merge(own(sec.id), VIEW) : NO_FLAGS)}
                aria-label={title}
              />
            </header>
            <ul className={cn(!open && "pointer-events-none opacity-45")}>{items.map((m) => row(m, !open))}</ul>
          </section>
        );
      })}

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center gap-3 border-b bg-[#141414] px-4 py-2.5 text-white">
          <span className="font-display text-lg uppercase tracking-wide">{t("people.group.project")}</span>
        </header>
        <ul>{projectMods.map((m) => row(m))}</ul>
      </section>

      {otherMods.length ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="flex items-center gap-3 border-b bg-[#141414] px-4 py-2.5 text-white">
            <span className="font-display text-lg uppercase tracking-wide">{t("adm.perm.other")}</span>
          </header>
          <ul>{otherMods.map((m) => row(m))}</ul>
        </section>
      ) : null}
    </div>
  );
}
