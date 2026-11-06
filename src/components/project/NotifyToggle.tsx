import { useState } from "react";
import { Bell } from "lucide-react";
import { readEventPref, writeEventPref, type EventKind, type EventPref } from "@/lib/notify-events";
import { useI18n } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * One line with a switch: tell the project's people about this kind of event. It remembers how it was left, so the choice is
 * made once and never asked again with a pop-up. When on, email and/or text message can be picked.
 */
export function NotifyToggle({ kind, who }: { kind: EventKind; who: "clients" | "staff" }) {
  const { t } = useI18n();
  const [pref, setPref] = useState<EventPref>(() => readEventPref(kind));
  const set = (next: EventPref) => {
    setPref(next);
    writeEventPref(kind, next);
  };
  const chip = (id: "email" | "sms", label: string) => (
    <button
      type="button"
      aria-pressed={pref[id]}
      onClick={() => set({ ...pref, [id]: !pref[id] })}
      className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", pref[id] ? "border-primary bg-primary/15" : "text-muted-foreground hover:bg-muted")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Switch checked={pref.on} onCheckedChange={(on) => set({ ...pref, on })} aria-label={t(who === "clients" ? "nt.clients" : "nt.staff")} />
        <Bell className="size-4 text-muted-foreground" />
        {t(who === "clients" ? "nt.clients" : "nt.staff")}
      </label>
      {pref.on ? (
        <span className="flex items-center gap-1.5">
          {chip("email", t("ntf.email"))}
          {chip("sms", t("ntf.sms"))}
        </span>
      ) : null}
    </div>
  );
}
