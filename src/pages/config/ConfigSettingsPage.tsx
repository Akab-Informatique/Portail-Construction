import { FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, Cloud, FileText, Mail, Send, Settings, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  COMPANY_KEY,
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATES_KEY,
  EMPTY_QUICKBOOKS,
  EMPTY_SHAREPOINT,
  EMPTY_SMTP,
  QUICKBOOKS_KEY,
  SHAREPOINT_KEY,
  SMTP_KEY,
  getCompanyProfile,
  getEmailTemplates,
  getQuickBooksSettings,
  getSharePointSettings,
  getSmtpSettings,
  quickbooksReady,
  setSetting,
  smtpReady,
  sharepointReady,
} from "@/lib/settings";
import { DEFAULT_COMPANY } from "@/lib/invoice";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { MessageKey } from "@/lib/i18n/en";
import { ConfigClientsPage } from "./ConfigClientsPage";
import { ConfigInternalUsersPage } from "./ConfigInternalUsersPage";
import type { CompanyProfile, EmailTemplateKey, EmailTemplates, QuickBooksSettings, SharePointSettings, SmtpSettings } from "@/lib/types";

const TABS = ["company", "email", "templates", "quickbooks", "sharepoint", "clients", "users"] as const;
type SetupTab = (typeof TABS)[number];

function isSetupTab(value: string | null): value is SetupTab {
  return TABS.includes(value as SetupTab);
}

const GROUPS: { label: MessageKey; items: { id: SetupTab; icon: LucideIcon; label: MessageKey }[] }[] = [
  { label: "settings.group.general", items: [{ id: "company", icon: Building2, label: "settings.tab.company" }] },
  {
    label: "settings.group.communication",
    items: [
      { id: "email", icon: Mail, label: "settings.tab.email" },
      { id: "templates", icon: FileText, label: "settings.tab.templates" },
    ],
  },
  {
    label: "settings.group.integrations",
    items: [
      { id: "quickbooks", icon: Wallet, label: "settings.tab.quickbooks" },
      { id: "sharepoint", icon: Cloud, label: "settings.tab.sharepoint" },
    ],
  },
  {
    label: "settings.group.people",
    items: [
      { id: "clients", icon: Building2, label: "settings.tab.clients" },
      { id: "users", icon: Users, label: "settings.tab.users" },
    ],
  },
];

const TEMPLATE_KEYS: { key: EmailTemplateKey; label: MessageKey; hint?: MessageKey }[] = [
  { key: "send_invoice", label: "settings.templates.invoice" },
  { key: "send_quote", label: "settings.templates.quote" },
  { key: "follow_up", label: "settings.templates.followUp", hint: "settings.templates.followUpHint" },
  { key: "password_reset", label: "settings.templates.passwordReset", hint: "settings.templates.passwordResetHint" },
];

export function ConfigSettingsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [testTo, setTestTo] = useState("");
  const [smtpTest, setSmtpTest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY);
  const [smtp, setSmtp] = useState<SmtpSettings>(EMPTY_SMTP);
  const [qb, setQb] = useState<QuickBooksSettings>(EMPTY_QUICKBOOKS);
  const [sp, setSp] = useState<SharePointSettings>(EMPTY_SHAREPOINT);
  const [templates, setTemplates] = useState<EmailTemplates>(DEFAULT_EMAIL_TEMPLATES);
  const [spTest, setSpTest] = useState<string | null>(null);

  const tab = useMemo<SetupTab>(() => {
    const requested = params.get("tab");
    return isSetupTab(requested) ? requested : "company";
  }, [params]);

  useEffect(() => {
    void (async () => {
      try {
        setCompany(await getCompanyProfile());
        setSmtp(await getSmtpSettings());
        setQb(await getQuickBooksSettings());
        setSp(await getSharePointSettings());
        setTemplates(await getEmailTemplates());
      } catch (err) {
        console.error("settings load failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function closeOverlay() {
    if (location.key !== "default") navigate(-1);
    else navigate("/");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  async function onTestSmtp() {
    setSmtpTest(null);
    setSaving(true);
    try {
      await setSetting(SMTP_KEY, JSON.stringify(smtp));
      const res = await fetch("/api/db", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "smtp_test", to: testTo.trim() || user?.email || "" }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; local?: boolean };
      if (data.ok) setSmtpTest(t("settings.smtp.testOk"));
      else if (data.local) setSmtpTest(t("settings.smtp.testLocal"));
      else setSmtpTest(data.error || t("settings.sp.testFail"));
    } catch (err) {
      setSmtpTest(err instanceof Error ? err.message : t("settings.sp.testFail"));
    } finally {
      setSaving(false);
    }
  }

  function setTab(next: string) {
    const value = isSetupTab(next) ? next : "company";
    setSaved(false);
    setParams(value === "company" ? {} : { tab: value }, { replace: true });
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user?.is_admin) return;
    setSaving(true);
    setSaved(false);
    await setSetting(COMPANY_KEY, JSON.stringify(company));
    await setSetting(SMTP_KEY, JSON.stringify(smtp));
    await setSetting(QUICKBOOKS_KEY, JSON.stringify(qb));
    await setSetting(SHAREPOINT_KEY, JSON.stringify(sp));
    await setSetting(EMAIL_TEMPLATES_KEY, JSON.stringify(templates));
    setSaving(false);
    setSaved(true);
  }

  if (loading) return <PageSkeleton />;
  if (!user?.is_admin) {
    return (
      <EmptyState
        icon={<Settings className="size-5" />}
        title={t("config.restricted")}
        description={t("config.restrictedDesc")}
      />
    );
  }

  const currentLabel = GROUPS.flatMap((g) => g.items).find((i) => i.id === tab)?.label ?? "settings.tab.company";

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/55 backdrop-blur-[2px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeOverlay();
      }}
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        orientation="vertical"
        className="flex h-full w-full max-w-[1180px] flex-col gap-0 overflow-hidden border bg-background shadow-2xl sm:rounded-lg md:flex-row"
      >
        <aside className="flex shrink-0 flex-col border-b bg-muted/40 md:w-60 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-4 py-3 md:py-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">{t("nav.setup")}</p>
              <p className="font-display text-2xl leading-none">{t("settings.title")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={closeOverlay} aria-label={t("settings.close")}>
              <X className="size-4" />
            </Button>
          </div>
          <nav className="flex gap-4 overflow-x-auto px-3 pb-3 md:flex-col md:gap-5 md:overflow-y-auto md:pb-5">
            {GROUPS.map((group) => (
              <div key={group.label} className="flex shrink-0 items-center gap-1 md:flex-col md:items-stretch md:gap-0.5">
                <p className="hidden px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground md:block">
                  {t(group.label)}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === tab;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={
                        "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm transition-colors " +
                        (active
                          ? "bg-primary/15 font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground")
                      }
                    >
                      <Icon className="size-4" />
                      {t(item.label)}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
            <div>
              <h2 className="font-display text-[26px] leading-none">{t(currentLabel)}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("settings.desc")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="hidden md:inline-flex" onClick={closeOverlay} aria-label={t("settings.close")}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <TabsContent value="company">
          <form onSubmit={onSave} className="grid gap-5">
            <Card className="gap-4 p-5">
              <div>
                <p className="text-sm font-medium">{t("settings.company")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.companyHint")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("settings.legalName")}>
                  <Input value={company.legal_name} onChange={(e) => setCompany({ ...company, legal_name: e.target.value })} />
                </Field>
                <Field label={t("clients.email")}>
                  <Input type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
                </Field>
                <Field label={t("clients.street")}>
                  <Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
                </Field>
                <Field label={t("clients.phone")}>
                  <Input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
                </Field>
                <Field label={t("clients.city")}>
                  <Input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("clients.province")}>
                    <Input value={company.province} onChange={(e) => setCompany({ ...company, province: e.target.value })} />
                  </Field>
                  <Field label={t("clients.postal")}>
                    <Input value={company.postal} onChange={(e) => setCompany({ ...company, postal: e.target.value })} />
                  </Field>
                </div>
                <Field label={t("settings.gst")}>
                  <Input value={company.gst} onChange={(e) => setCompany({ ...company, gst: e.target.value })} />
                </Field>
                <Field label={t("settings.qst")}>
                  <Input value={company.qst} onChange={(e) => setCompany({ ...company, qst: e.target.value })} />
                </Field>
              </div>
            </Card>
            <SaveBar saved={saved} saving={saving} />
          </form>
        </TabsContent>

        <TabsContent value="email">
          <form onSubmit={onSave} className="grid gap-5">
            <Card className="gap-4 p-5">
              <div>
                <p className="text-sm font-medium">{t("settings.smtp")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.smtpHint")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("settings.host")}>
                  <Input placeholder="smtp.office365.com" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
                </Field>
                <Field label={t("settings.port")}>
                  <Input value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} />
                </Field>
                <Field label={t("settings.username")}>
                  <Input autoComplete="off" value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} />
                </Field>
                <Field label={t("settings.password")}>
                  <Input type="password" autoComplete="new-password" value={smtp.password} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} />
                </Field>
                <Field label={t("settings.fromName")}>
                  <Input value={smtp.from_name} onChange={(e) => setSmtp({ ...smtp, from_name: e.target.value })} />
                </Field>
                <Field label={t("settings.fromEmail")}>
                  <Input type="email" value={smtp.from_email} onChange={(e) => setSmtp({ ...smtp, from_email: e.target.value })} />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{t("settings.secure")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.secureHint")}</p>
                </div>
                <Switch checked={smtp.secure} onCheckedChange={(v) => setSmtp({ ...smtp, secure: v })} />
              </div>
              <Field label={t("settings.portalUrl")}>
                <Input
                  type="url"
                  placeholder="https://portail.frx.construction"
                  value={smtp.portal_url ?? ""}
                  onChange={(e) => setSmtp({ ...smtp, portal_url: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t("settings.portalUrlHint")}</p>
              </Field>
              <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed px-3 py-3">
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <Label>{t("settings.smtp.testTo")}</Label>
                  <Input type="email" placeholder={user?.email ?? ""} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                </div>
                <Button type="button" variant="outline" disabled={saving || !smtpReady(smtp)} onClick={() => void onTestSmtp()}>
                  <Send className="size-3.5" />
                  {t("settings.smtp.test")}
                </Button>
                {smtpTest ? <p className="w-full text-sm text-muted-foreground">{smtpTest}</p> : null}
              </div>
            </Card>
            <SaveBar saved={saved} saving={saving} />
          </form>
        </TabsContent>

        <TabsContent value="templates">
          <form onSubmit={onSave} className="grid gap-5">
            <Card className="gap-4 p-5">
              <div>
                <p className="text-sm font-medium">{t("settings.templates.title")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.templates.hint")}</p>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                {TEMPLATE_KEYS.map(({ key, label, hint }) => (
                  <div key={key} className="space-y-3 rounded-lg border p-4">
                    <div>
                      <p className="text-sm font-medium">{t(label)}</p>
                      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{t(hint)}</p> : null}
                    </div>
                    <Field label={t("settings.templates.subject")}>
                      <Input
                        value={templates[key].subject}
                        onChange={(e) =>
                          setTemplates({
                            ...templates,
                            [key]: { ...templates[key], subject: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label={t("settings.templates.body")}>
                      <Textarea
                        rows={7}
                        value={templates[key].body}
                        onChange={(e) =>
                          setTemplates({
                            ...templates,
                            [key]: { ...templates[key], body: e.target.value },
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </Card>
            <SaveBar saved={saved} saving={saving} />
          </form>
        </TabsContent>

        <TabsContent value="quickbooks">
          <form onSubmit={onSave} className="grid gap-5">
            <Card className="gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t("settings.qb.title")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.qb.hint")}</p>
                </div>
                <span className="rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {qb.connected ? t("settings.qb.connected") : t("settings.qb.disconnected")}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("settings.qb.clientId")}>
                  <Input value={qb.client_id} onChange={(e) => setQb({ ...qb, client_id: e.target.value })} autoComplete="off" />
                </Field>
                <Field label={t("settings.qb.clientSecret")}>
                  <Input type="password" value={qb.client_secret} onChange={(e) => setQb({ ...qb, client_secret: e.target.value })} autoComplete="new-password" />
                </Field>
                <Field label={t("settings.qb.realm")}>
                  <Input value={qb.realm_id} onChange={(e) => setQb({ ...qb, realm_id: e.target.value })} />
                </Field>
                <Field label={t("settings.qb.env")}>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={qb.environment}
                    onChange={(e) => setQb({ ...qb, environment: e.target.value === "production" ? "production" : "sandbox" })}
                  >
                    <option value="sandbox">{t("settings.qb.sandbox")}</option>
                    <option value="production">{t("settings.qb.production")}</option>
                  </select>
                </Field>
              </div>
              {qb.last_sync ? <p className="text-xs text-muted-foreground">{t("settings.qb.lastSync", { date: qb.last_sync })}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!quickbooksReady(qb)}
                  onClick={() => setQb({ ...qb, connected: !qb.connected })}
                >
                  {qb.connected ? t("settings.qb.disconnect") : t("settings.qb.connect")}
                </Button>
                {!quickbooksReady(qb) ? <p className="self-center text-xs text-muted-foreground">{t("settings.qb.needKeys")}</p> : null}
              </div>
            </Card>
            <SaveBar saved={saved} saving={saving} />
          </form>
        </TabsContent>

        <TabsContent value="sharepoint">
          <form onSubmit={onSave} className="grid gap-5">
            <Card className="gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t("settings.sp.title")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.sp.hint")}</p>
                </div>
                <span className="rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {sp.connected ? t("settings.sp.connected") : t("settings.sp.disconnected")}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("settings.sp.tenant")}>
                  <Input value={sp.tenant_id} onChange={(e) => setSp({ ...sp, tenant_id: e.target.value })} autoComplete="off" />
                </Field>
                <Field label={t("settings.sp.clientId")}>
                  <Input value={sp.client_id} onChange={(e) => setSp({ ...sp, client_id: e.target.value })} autoComplete="off" />
                </Field>
                <Field label={t("settings.sp.clientSecret")}>
                  <Input
                    type="password"
                    value={sp.client_secret}
                    onChange={(e) => setSp({ ...sp, client_secret: e.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label={t("settings.sp.site")}>
                  <Input
                    placeholder="https://contoso.sharepoint.com/sites/Jobs"
                    value={sp.site_url}
                    onChange={(e) => setSp({ ...sp, site_url: e.target.value })}
                  />
                </Field>
                <Field label={t("settings.sp.library")}>
                  <Input value={sp.library_name} onChange={(e) => setSp({ ...sp, library_name: e.target.value })} />
                </Field>
                <Field label={t("settings.sp.drive")}>
                  <Input value={sp.drive_id} onChange={(e) => setSp({ ...sp, drive_id: e.target.value })} placeholder={t("settings.sp.driveHint")} />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">{t("settings.sp.aclNote")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? t("clients.saving") : t("settings.save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!sharepointReady(sp)}
                  onClick={async () => {
                    setSpTest(null);
                    try {
                      const res = await fetch("/api/sharepoint", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "test", config: sp }),
                      });
                      const payload = (await res.json()) as { ok?: boolean; driveId?: string; error?: string };
                      if (!res.ok) throw new Error(payload.error || "Test failed");
                      setSp({ ...sp, connected: true, drive_id: payload.driveId || sp.drive_id });
                      setSpTest(t("settings.sp.testOk"));
                    } catch (err) {
                      setSp({ ...sp, connected: false });
                      setSpTest(err instanceof Error ? err.message : t("settings.sp.testFail"));
                    }
                  }}
                >
                  {t("settings.sp.test")}
                </Button>
                {spTest ? <p className="text-sm text-muted-foreground">{spTest}</p> : null}
              </div>
            </Card>
          </form>
        </TabsContent>
        <TabsContent value="clients">
          <ConfigClientsPage embedded />
        </TabsContent>
        <TabsContent value="users">
          <ConfigInternalUsersPage embedded />
        </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

function SaveBar({ saved, saving }: { saved: boolean; saving: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-3">
      {saved ? <p className="text-sm text-muted-foreground">{t("settings.saved")}</p> : null}
      <Button type="submit" disabled={saving}>
        {saving ? t("clients.saving") : t("settings.save")}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
