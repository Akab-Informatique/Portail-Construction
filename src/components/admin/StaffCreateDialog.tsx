import { FormEvent, useEffect, useState } from "react";
import { CalendarCheck, KeyRound, Mail, UserRound, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { logActivity } from "@/lib/activity";
import { initials } from "@/lib/format";
import { hashPassword, randomPassword } from "@/lib/password";
import { setUserGroups, isDefaultClientGroup, isDefaultStaffGroup } from "@/lib/access";
import { adminPrefs, createUser, sendUserLink } from "@/lib/users-api";
import { moveUserToCompany } from "@/lib/admin-access";
import type { AccessGroup, Client } from "@/lib/types";
import { Block, LanguageSelect } from "@/components/admin/StaffProfile";
import { GroupPicker } from "@/pages/config/GroupPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Form = {
  name: string;
  email: string;
  title: string;
  phone: string;
  password: string;
  mustChange: boolean;
  admin: boolean;
  lang: "fr" | "en";
  groupIds: number[];
  o365: boolean;
  morning: boolean;
  invite: boolean;
  companyId: number | null;
};

/**
 * Add an employee: who they are, how they sign in, their language and own settings, and the groups they start in. When the
 * account is created, the person's access sheet opens (menu, projects, folders, reports) so everything is set in one go.
 */
export function StaffCreateDialog({
  open,
  groups,
  onClose,
  onCreated,
  kind = "staff",
  clients = [],
  defaultCompanyId = null,
}: {
  open: boolean;
  groups: AccessGroup[];
  onClose: () => void;
  onCreated: (userId: number, notice: { ok: boolean; text: string }) => void;
  /** A client user: no administrator switch, no Outlook or morning email, and a company to belong to. */
  kind?: "staff" | "client";
  clients?: Client[];
  defaultCompanyId?: number | null;
}) {
  const client = kind === "client";
  const { t, tr } = useI18n();
  const { realUser } = useAuth();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF({ name: "", email: "", title: "", phone: "", password: randomPassword(), mustChange: true, admin: false, lang: "fr", groupIds: groups.filter(client ? isDefaultClientGroup : isDefaultStaffGroup).map((g) => g.id), o365: false, morning: false, invite: true, companyId: defaultCompanyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!f) return null;
  const set = (patch: Partial<Form>) => setF((cur) => (cur ? { ...cur, ...patch } : cur));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f || !realUser?.is_admin) return;
    setBusy(true);
    setError(null);
    try {
      const email = f.email.trim().toLowerCase();
      const name = f.name.trim();
      const created = await createUser({
        name,
        email,
        password: await hashPassword(f.password.trim() || randomPassword()),
        user_type: client ? "external" : "internal",
        title: f.title.trim() || null,
        phone: f.phone.trim() || null,
        is_admin: client ? false : f.admin,
        avatar_initials: initials(name),
        must_change_password: f.mustChange,
        locale: f.lang,
      });
      if (client && f.companyId) await moveUserToCompany(created.id, f.companyId);
      if (f.groupIds.length) await setUserGroups(created.id, f.groupIds);
      if (!client && (f.o365 || f.morning)) await adminPrefs(created.id, { o365_calendar: f.o365 ? 1 : 0, morning_email: f.morning ? 1 : 0 });
      await logActivity({ action: "created user", details: `${name} (${client ? "external" : "internal"})`, userId: realUser.id });
      let notice = { ok: true, text: t("adm.accountCreated") };
      if (f.invite) {
        try {
          const out = await sendUserLink(created.id, "invite", f.lang);
          notice = out.local ? { ok: false, text: t("cu.linkLocal") } : { ok: true, text: t("cu.inviteSent", { email }) };
        } catch (err) {
          notice = { ok: false, text: `${t("adm.inviteFailed")} ${tr(err, "users.link.failed")}` };
        }
      }
      onCreated(created.id, notice);
    } catch (err) {
      setError(tr(err, "users.error.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl uppercase tracking-wide">{t(client ? "adm.newc.title" : "adm.new.title")}</DialogTitle>
          <DialogDescription>{t(client ? "adm.newc.desc" : "adm.new.desc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Block n={1} title={t("adm.prof.identity")} icon={UserRound}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("people.fullName")}</Label>
                <Input required autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("people.email")}</Label>
                <Input type="email" required value={f.email} onChange={(e) => set({ email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("people.titleField")}</Label>
                <Input value={f.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("people.phone")}</Label>
                <Input value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
            </div>
            {client ? (
              <div className="space-y-1.5">
                <Label>{t("adm.prof.company")}</Label>
                <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={f.companyId ?? ""} onChange={(e) => set({ companyId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t("adm.prof.noCompany")}</option>
                  {[...clients].sort((a, b) => a.company_name.localeCompare(b.company_name)).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{t("adm.prof.companyHint")}</p>
              </div>
            ) : null}
          </Block>

          <Block n={2} title={t("adm.prof.account")} icon={KeyRound}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("people.tempPassword")}</Label>
                <Input value={f.password} onChange={(e) => set({ password: e.target.value })} />
              </div>
              <label className="flex items-start gap-2 self-end pb-2 text-sm">
                <Checkbox className="mt-0.5" checked={f.mustChange} onCheckedChange={(v) => set({ mustChange: v === true })} />
                <span>
                  {t("people.mustChange")}
                  <span className="block text-xs text-muted-foreground">{t("people.mustChangeHint")}</span>
                </span>
              </label>
            </div>
            <label className={client ? "hidden" : "flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5"}>
              <span>
                <span className="block text-sm font-medium">{t("people.adminLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("people.adminHint")}</span>
              </span>
              <Switch checked={f.admin} onCheckedChange={(v) => set({ admin: v })} />
            </label>
          </Block>

          <Block n={3} title={t("adm.prof.prefs")} hint={t("adm.new.prefsHint")} icon={CalendarCheck}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <span className="text-sm font-medium">{t("adm.prof.language")}</span>
              <LanguageSelect value={f.lang} onChange={(lang) => set({ lang })} />
            </div>
            <label className={client ? "hidden" : "flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5"}>
              <span>
                <span className="block text-sm font-medium">{t("profile.o365Toggle")}</span>
                <span className="block text-xs text-muted-foreground">{t("adm.prof.o365Hint")}</span>
              </span>
              <Switch checked={f.o365} onCheckedChange={(v) => set({ o365: v })} />
            </label>
            <label className={client ? "hidden" : "flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5"}>
              <span>
                <span className="block text-sm font-medium">{t("adm.prof.morning")}</span>
                <span className="block text-xs text-muted-foreground">{t("adm.prof.morningHint")}</span>
              </span>
              <Switch checked={f.morning} onCheckedChange={(v) => set({ morning: v })} />
            </label>
            <p className="text-xs text-muted-foreground">{t("adm.new.firstLogin")}</p>
          </Block>

          {!f.admin || client ? (
            <Block n={4} title={t("adm.new.groups")} hint={t("adm.new.groupsHint")} icon={Users}>
              <GroupPicker groups={groups} selected={f.groupIds} onChange={(groupIds) => set({ groupIds })} />
            </Block>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={f.invite} onCheckedChange={(v) => set({ invite: v === true })} />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Mail className="size-3.5" />
                {t("adm.sendInvite")}
              </span>
              <span className="block text-xs text-muted-foreground">{t("adm.sendInviteHint")}</span>
            </span>
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("people.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("people.creating") : t("adm.new.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
