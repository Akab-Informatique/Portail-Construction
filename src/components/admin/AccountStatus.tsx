import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { accountState, useUserLogins, type AccountState } from "@/lib/user-logins";
import { cn } from "@/lib/utils";

const TONE: Record<AccountState, string> = {
  inactive: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  pending: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  never: "bg-muted text-muted-foreground",
};

/**
 * The account's state (activated, waiting for the person to activate it, never signed in, inactive) and when they last
 * signed in. Shown to administrators; the records are not readable by anyone else.
 */
export function AccountStatus({ user, compact = false, className }: { user: { id: number; is_active: number; must_change_password: number }; compact?: boolean; className?: string }) {
  const { t, locale } = useI18n();
  const login = useUserLogins().get(user.id);
  const state = accountState(user, login);
  const last = login?.last_login_at ? formatDateTime(login.last_login_at as unknown as string, locale) : null;
  const badge = <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", TONE[state])}>{t(`acct.${state}` as "acct.active")}</span>;
  if (compact) {
    return (
      <span className={cn("flex shrink-0 flex-col items-end gap-0.5", className)}>
        {badge}
        <span className="text-[10px] tabular-nums text-muted-foreground">{last ?? t("acct.noLogin")}</span>
      </span>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs", className)}>
      {badge}
      <span className="text-muted-foreground">
        {t("acct.lastLogin")} : <span className="font-medium text-foreground tabular-nums">{last ?? t("acct.noLogin")}</span>
      </span>
      {login?.activated_at ? (
        <span className="text-muted-foreground">
          {t("acct.activatedOn")} : <span className="font-medium text-foreground tabular-nums">{formatDateTime(login.activated_at as unknown as string, locale)}</span>
        </span>
      ) : null}
    </div>
  );
}
