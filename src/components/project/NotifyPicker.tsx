import { useEffect, useState } from "react";
import { Bell, ChevronDown, Mail, MessageSquare } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { NotifyChannel } from "@/lib/notify";
import type { User } from "@/lib/types";
import { UserAvatar } from "@/components/UserAvatar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type NotifyChoice = { userIds: number[]; channels: NotifyChannel[] };

/** "Tell people": pick who, and whether by email, text message, or both. Closed until opened. */
export function NotifyPicker({
  people,
  value,
  onChange,
  preselect = [],
}: {
  people: User[];
  value: NotifyChoice;
  onChange: (next: NotifyChoice) => void;
  /** Ids ticked the first time the picker opens (for example the project's people in charge). */
  preselect?: number[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && value.userIds.length === 0 && preselect.length) onChange({ ...value, userIds: preselect });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const channelBtn = (ch: NotifyChannel, label: string, Icon: typeof Mail) => {
    const on = value.channels.includes(ch);
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange({ ...value, channels: on ? value.channels.filter((c) => c !== ch) : [...value.channels, ch] })}
        className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors", on ? "border-primary bg-primary/15 font-medium" : "text-muted-foreground hover:bg-muted")}
      >
        <Icon className="size-4" />
        {label}
      </button>
    );
  };

  const count = value.userIds.length;
  return (
    <div className="rounded-xl border bg-muted/20">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium">
        <Bell className="size-4 text-muted-foreground" />
        {t("ntf.title")}
        {count && value.channels.length ? <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums">{count}</span> : null}
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex flex-wrap gap-2">
            {channelBtn("email", t("ntf.email"), Mail)}
            {channelBtn("sms", t("ntf.sms"), MessageSquare)}
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {people.map((p) => {
              const on = value.userIds.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                    <Checkbox checked={on} onCheckedChange={(v) => onChange({ ...value, userIds: v === true ? [...value.userIds, p.id] : value.userIds.filter((id) => id !== p.id) })} />
                    <UserAvatar name={p.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
