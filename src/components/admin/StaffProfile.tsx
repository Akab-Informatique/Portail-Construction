import { FormEvent, useEffect, useState } from "react";
import { eq } from "drizzle-orm";
import { CalendarCheck, GraduationCap, KeyRound, Loader2, Mail, Newspaper, Trash2, UserRound } from "lucide-react";
import { db, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { hashPassword } from "@/lib/password";
import { adminPrefs, removeClientUser, removeStaffUser, sendUserLink, updateUser, type PersonPrefs } from "@/lib/users-api";
import { moveUserToCompany } from "@/lib/admin-access";
import type { Client, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A framed block of the profile, with a number and a title, in the same steel look as the Access tabs. */
export function Block({ n, title, hint, icon: Icon, children }: { n: number; title: string; hint?: string; icon: typeof UserRound; children: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <header className="flex items-center gap-3 border-b bg-[#141414] px-4 py-2.5 text-white">
        <span className="font-display text-xl leading-none text-primary">{String(n).padStart(2, "0")}</span>
        <Icon className="size-4 text-white/70" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg uppercase leading-tight tracking-wide">{title}</p>
          {hint ? <p className="text-[11px] text-white/55">{hint}</p> : null}
        </div>
      </header>
      <div className="grid gap-4 p-4">{children}</div>
    </Card>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5", disabled && "opacity-60")}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

export function LanguageSelect({ value, onChange }: { value: "fr" | "en"; onChange: (v: "fr" | "en") => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {(
        [
          ["fr", t("adm.lang.fr")],
          ["en", t("adm.lang.en")],
        ] as const
      ).map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold transition-colors", value === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * The profile of an employee as the administrator sees it: who they are, their account, and their own settings (language,
 * the menu tutorial, the Outlook calendar and the morning email). Access is set in the other tabs.
 */
export function StaffProfile({
  person,
  onChanged,
  onDeleted,
  kind = "staff",
  clients = [],
  companyId = null,
}: {
  person: User;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  /** A client user has no administrator switch, no Outlook or morning email, and belongs to one company. */
  kind?: "staff" | "client";
  clients?: Client[];
  companyId?: number | null;
}) {
  const client = kind === "client";
  const { t, tr } = useI18n();
  const { realUser } = useAuth();
  const [form, setForm] = useState({ name: person.name, email: person.email, title: person.title ?? "", phone: person.phone ?? "", password: "" });
  const [active, setActive] = useState(person.is_active === 1);
  const [admin, setAdmin] = useState(person.is_admin === 1);
  const [mustChange, setMustChange] = useState(person.must_change_password === 1);
  const [lang, setLang] = useState<"fr" | "en">(person.locale === "en" ? "en" : "fr");
  const [tutorial, setTutorial] = useState(person.tutorial_done !== 1);
  const [prefs, setPrefs] = useState<PersonPrefs>({ o365_calendar: 0, morning_email: 0 });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSelf = realUser?.id === person.id;

  useEffect(() => {
    if (!client) void adminPrefs(person.id).then(setPrefs).catch(() => undefined);
  }, [person.id, client]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      await updateUser({
        id: person.id,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        title: form.title.trim() || null,
        phone: form.phone.trim() || null,
        is_admin: client ? false : admin,
        is_active: active,
        avatar_initials: initials(form.name.trim()),
        must_change_password: mustChange,
        password: form.password.trim() ? await hashPassword(form.password.trim()) : undefined,
      });
      setForm((f) => ({ ...f, password: "" }));
      setNote({ ok: true, text: t("people.saved") });
      await onChanged();
    } catch (err) {
      setNote({ ok: false, text: tr(err, "users.error.updateFailed") });
    } finally {
      setSaving(false);
    }
  }

  async function setLanguage(next: "fr" | "en") {
    setLang(next);
    await db.update(schema.users).set({ locale: next }).where(eq(schema.users.id, person.id));
    await onChanged();
  }

  async function setTutorialFlag(show: boolean) {
    setTutorial(show);
    await db.update(schema.users).set({ tutorial_done: show ? 0 : 1 }).where(eq(schema.users.id, person.id));
    await onChanged();
  }

  async function setPref(patch: Partial<PersonPrefs>) {
    setPrefs((p) => ({ ...p, ...patch }));
    setPrefs(await adminPrefs(person.id, patch));
  }

  async function link(kind: "invite" | "reset") {
    setBusy(kind);
    setNote(null);
    try {
      const out = await sendUserLink(person.id, kind, lang);
      setNote(out.local ? { ok: false, text: t("cu.linkLocal") } : { ok: true, text: t(kind === "invite" ? "cu.inviteSent" : "cu.resetSent", { email: out.email ?? person.email }) });
    } catch (err) {
      setNote({ ok: false, text: tr(err, "users.link.failed") });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      if (client) await removeClientUser(person.id, companyId ?? 0);
      else await removeStaffUser(person.id, realUser?.id);
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      setConfirmDelete(false);
      setNote({ ok: false, text: tr(err, "users.error.updateFailed") });
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={save} className="grid gap-4">
        <Block n={1} title={t("adm.prof.identity")} hint={t("adm.prof.identityHint")} icon={UserRound}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("people.fullName")}</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("people.email")}</Label>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("people.titleField")}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("people.phone")}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          {client ? (
            <div className="space-y-1.5">
              <Label>{t("adm.prof.company")}</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={companyId ?? ""}
                onChange={(e) => void moveUserToCompany(person.id, e.target.value ? Number(e.target.value) : null).then(onChanged)}
              >
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

        <Block n={2} title={t("adm.prof.account")} hint={t("adm.prof.accountHint")} icon={KeyRound}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle label={t("people.activeAccount")} hint={t("people.activeHint")} checked={active} onChange={setActive} disabled={isSelf} />
            {client ? null : <Toggle label={t("people.adminLabel")} hint={t("people.adminHint")} checked={admin} onChange={setAdmin} disabled={isSelf} />}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("people.newPassword")}</Label>
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("people.newPasswordHint")}</p>
            </div>
            <label className="flex items-start gap-2 self-end pb-2 text-sm">
              <Checkbox className="mt-0.5" checked={mustChange} onCheckedChange={(v) => setMustChange(v === true)} />
              <span>
                {t("people.mustChange")}
                <span className="block text-xs text-muted-foreground">{t("people.mustChangeHint")}</span>
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy !== null || !active} onClick={() => void link("invite")}>
              {busy === "invite" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              {t("cu.resendInvite")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy !== null || !active} onClick={() => void link("reset")}>
              {busy === "reset" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {t("cu.resetPassword")}
            </Button>
          </div>
        </Block>

        {note ? <p className={cn("rounded-lg border px-3 py-2 text-sm", note.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10 text-destructive")}>{note.text}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? t("people.saving") : t("people.saveProfile")}
          </Button>
        </div>
      </form>

      <Block n={3} title={t("adm.prof.prefs")} hint={t("adm.prof.prefsHint")} icon={CalendarCheck}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">{t("adm.prof.language")}</span>
            <span className="block text-xs text-muted-foreground">{t("adm.prof.languageHint")}</span>
          </span>
          <LanguageSelect value={lang} onChange={(v) => void setLanguage(v)} />
        </div>
        <Toggle label={t("adm.prof.tutorial")} hint={t("adm.prof.tutorialHint")} checked={tutorial} onChange={(v) => void setTutorialFlag(v)} />
        {client ? null : <Toggle label={t("profile.o365Toggle")} hint={t("adm.prof.o365Hint")} checked={prefs.o365_calendar === 1} onChange={(v) => void setPref({ o365_calendar: v ? 1 : 0 })} />}
        {client ? null : <Toggle label={t("adm.prof.morning")} hint={t("adm.prof.morningHint")} checked={prefs.morning_email === 1} onChange={(v) => void setPref({ morning_email: v ? 1 : 0 })} />}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Newspaper className="size-3.5" />
          <GraduationCap className="size-3.5" />
          {t("adm.prof.ownerCanChange")}
        </p>
      </Block>

      {!isSelf ? (
        <div className="flex justify-end">
          <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" />
            {t("adm.staffDelete")}
          </Button>
        </div>
      ) : null}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("adm.staffDeleteTitle", { name: person.name })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("adm.staffDeleteBody")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("people.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              <Trash2 className="size-4" />
              {t("adm.staffDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
