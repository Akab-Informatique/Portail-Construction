import { FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale, ThemePref } from "@/lib/types";

export function ProfilePage() {
  const { user, realUser, updateProfile, changePassword, setTutorialOnLogin } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState(user?.name ?? "");
  const [title, setTitle] = useState(user?.title ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  if (!user) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await updateProfile({
      name: name.trim(),
      title: title.trim() || null,
      phone: phone.trim() || null,
    });
    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  async function onLanguage(next: Locale) {
    setLocale(next);
    await updateProfile({ locale: next });
  }

  async function onTheme(next: ThemePref) {
    setTheme(next);
    await updateProfile({ theme: next });
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw !== confirmPw) {
      setPwMsg(t("profile.passwordMismatch"));
      return;
    }
    setPwSaving(true);
    const err = await changePassword(currentPw, newPw);
    setPwSaving(false);
    if (err) {
      setPwMsg(t(err as "profile.passwordWrong"));
      return;
    }
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setPwMsg(t("profile.passwordUpdated"));
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("profile.eyebrow")}
        title={t("profile.title")}
        actions={
          <div className="flex items-center gap-3">
            <UserAvatar name={user.name} hint={user.avatar_initials} size="lg" />
            <StatusBadge value={user.user_type} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="text-base">{t("profile.identity")}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-5">
            <form onSubmit={onSave} className="grid gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">{t("profile.name")}</Label>
                <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-email">{t("profile.email")}</Label>
                <Input id="profile-email" value={user.email} disabled />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-title">{t("profile.titleField")}</Label>
                  <Input id="profile-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-phone">{t("profile.phone")}</Label>
                  <Input id="profile-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? t("profile.saving") : t("profile.save")}
                </Button>
                {saved && <span className="text-sm text-muted-foreground">{t("profile.saved")}</span>}
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="text-base">{t("profile.language")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              <div className="grid grid-cols-2 gap-2">
                {(["en", "fr"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onLanguage(code)}
                    className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                      locale === code
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <span className="block font-medium">{t(`profile.lang.${code}`)}</span>
                    <span className={locale === code ? "text-primary-foreground/70" : "text-muted-foreground"}>
                      {code === "en" ? "EN" : "FR"}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="text-base">{t("profile.theme")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              <div className="grid grid-cols-2 gap-2">
                {(["light", "dark"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onTheme(mode)}
                    className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                      theme === mode
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {t(`profile.theme.${mode}`)}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="text-base">{t("profile.tutorial")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                <span className="text-sm font-medium">{t("profile.tutorialToggle")}</span>
                <Switch
                  checked={!realUser?.tutorial_done}
                  onCheckedChange={(checked) => void setTutorialOnLogin(checked)}
                  aria-label={t("profile.tutorialToggle")}
                />
              </label>
            </CardContent>
          </Card>
        </div>

        <Card className="py-0 lg:col-span-2">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="text-base">{t("profile.password")}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-5">
            <form onSubmit={onPassword} className="grid max-w-xl gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="current-pw">{t("profile.currentPassword")}</Label>
                <Input
                  id="current-pw"
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw">{t("profile.newPassword")}</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw">{t("profile.confirmPassword")}</Label>
                  <Input
                    id="confirm-pw"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    required
                  />
                </div>
              </div>
              {pwMsg && <p className="text-sm text-muted-foreground">{pwMsg}</p>}
              <div>
                <Button type="submit" disabled={pwSaving}>
                  {pwSaving ? t("profile.saving") : t("profile.updatePassword")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
