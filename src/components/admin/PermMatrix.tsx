import { Fragment } from "react";
import { MENU_MODULES, OTHER_MODULES } from "@/lib/constants";
import type { Flags } from "@/lib/admin-access";
import { NO_FLAGS } from "@/lib/admin-access";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { Checkbox } from "@/components/ui/checkbox";

const KEYS = ["can_view", "can_create", "can_edit", "can_delete"] as const;

/**
 * Every sidebar page and every module inside a project, with its four rights (see, add, change, delete). `inherited` is what
 * the person already gets from their groups: shown ticked and locked, so what is theirs alone is clear.
 */
export function PermMatrix({
  flags,
  inherited,
  onChange,
}: {
  flags: Record<string, Flags>;
  inherited?: Record<string, Flags>;
  onChange: (module: string, next: Flags) => void;
}) {
  const { t } = useI18n();
  const rows = [
    ...MENU_MODULES.map((m) => ({ m, heading: m.id === "app_overview" ? "people.group.menu" : null })),
    ...OTHER_MODULES.map((m) => ({ m, heading: m.id === OTHER_MODULES[0].id ? "people.group.project" : null })),
  ];
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("people.col.module")}</th>
            <th className="px-3 py-3 font-medium">{t("people.col.view")}</th>
            <th className="px-3 py-3 font-medium">{t("people.col.create")}</th>
            <th className="px-3 py-3 font-medium">{t("people.col.edit")}</th>
            <th className="px-3 py-3 font-medium">{t("people.col.delete")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ m, heading }) => {
            const own = flags[m.id] ?? NO_FLAGS;
            const via = inherited?.[m.id] ?? NO_FLAGS;
            const isSection = m.group === "menu" && !m.parent;
            const set = (key: keyof Flags, value: boolean) => {
              const next = { ...own, [key]: value };
              if (key !== "can_view" && value) next.can_view = true;
              if (key === "can_view" && !value) {
                next.can_create = false;
                next.can_edit = false;
                next.can_delete = false;
              }
              onChange(m.id, next);
            };
            return (
              <Fragment key={m.id}>
                {heading ? (
                  <tr className="bg-muted/30">
                    <td colSpan={5} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {t(heading as MessageKey)}
                    </td>
                  </tr>
                ) : null}
                <tr className={isSection ? "bg-muted/15 hover:bg-muted/30" : "hover:bg-muted/30"}>
                  <td className={m.parent ? "py-3 pr-4 pl-10" : "px-4 py-3"}>
                    <p className={isSection ? "font-semibold" : "font-medium"}>{m.labelKey ? t(m.labelKey as MessageKey) : t(`module.${m.id}` as MessageKey)}</p>
                    {m.group !== "menu" ? <p className="text-xs text-muted-foreground">{t(`module.${m.id}.desc` as MessageKey)}</p> : null}
                  </td>
                  {KEYS.map((k) => {
                    const locked = !own[k] && via[k];
                    return (
                      <td key={k} className="px-3 py-3">
                        <Checkbox
                          checked={own[k] || via[k]}
                          disabled={locked}
                          title={locked ? t("adm.viaGroup") : undefined}
                          onCheckedChange={(v) => set(k, v === true)}
                          aria-label={`${m.label} ${k.replace("can_", "")}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
