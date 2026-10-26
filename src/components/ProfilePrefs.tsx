import { useEffect, useState } from "react";
import { Loader2, Mail, CalendarCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { loadPrefs, NO_PREFS, personalCall, savePrefs, type UserPrefs } from "@/lib/user-prefs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const READABLE: Record<string, string> = {
  notConfigured: "Microsoft 365 / SharePoint is not set up in Setup.",
  noMailbox: "No email address on this account.",
  "email:notConfigured": "Email (SMTP) is not set up in Setup.",
};
const say = (code: string) => READABLE[code] ?? code;

/**
 * Two personal settings for staff: show their Outlook (Microsoft 365) calendar in the personal calendar, and get the
 * morning email (a short gazette of the day: project tasks and Outlook events).
 */
export function ProfilePrefs() {
  const { t } = useI18n();
  const { user, realUser } = useAuth();
  const me = realUser?.id ?? user?.id;
  const [prefs, setPrefs] = useState<UserPrefs>(NO_PREFS);
  const [note, setNote] = useState<{ where: "o365" | "morning"; text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState<"o365" | "morning" | null>(null);

  useEffect(() => {
    if (me) void loadPrefs(me).then(setPrefs);
  }, [me]);

  if (!me || user?.user_type !== "internal") return null;

  async function toggle(patch: Partial<UserPrefs>) {
    if (!me) return;
    setPrefs(await savePrefs(me, patch));
  }

  async function testOutlook() {
    setBusy("o365");
    setNote(null);
    const result = await personalCall({ action: "calendar_test" });
    setBusy(null);
    if (result.local) return setNote({ where: "o365", text: t("profile.o365Local") });
    if (result.error) return setNote({ where: "o365", text: t("profile.o365Fail", { m: say(result.error) }), bad: true });
    setNote({ where: "o365", text: t("profile.o365Ok", { n: result.events?.length ?? 0 }) });
  }

  async function sendMorning() {
    setBusy("morning");
    setNote(null);
    const result = await personalCall({ action: "morning_test" });
    setBusy(null);
    if (result.local) return setNote({ where: "morning", text: t("profile.o365Local") });
    if (result.error) return setNote({ where: "morning", text: t("profile.morningFail", { m: say(result.error) }), bad: true });
    setNote({ where: "morning", text: t("profile.morningSent", { email: result.sent ?? "" }) });
  }

  return (
    <>
      <Card className="py-0">
        <CardHeader className="border-b px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="size-4" />
            {t("profile.o365")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-5 py-5">
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <span className="text-sm font-medium">{t("profile.o365Toggle")}</span>
            <Switch checked={Boolean(prefs.o365_calendar)} onCheckedChange={(v) => void toggle({ o365_calendar: v ? 1 : 0 })} aria-label={t("profile.o365Toggle")} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={busy === "o365"} onClick={() => void testOutlook()}>
              {busy === "o365" ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("profile.o365Test")}
            </Button>
            {note?.where === "o365" ? <span className={note.bad ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{note.text}</span> : null}
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="border-b px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4" />
            {t("profile.morning")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-5 py-5">
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <span className="text-sm font-medium">{t("profile.morningToggle")}</span>
            <Switch checked={Boolean(prefs.morning_email)} onCheckedChange={(v) => void toggle({ morning_email: v ? 1 : 0 })} aria-label={t("profile.morningToggle")} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={busy === "morning"} onClick={() => void sendMorning()}>
              {busy === "morning" ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("profile.morningTest")}
            </Button>
            {note?.where === "morning" ? <span className={note.bad ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{note.text}</span> : null}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
