import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2, Mail, Plus, Search, Trash2, Users } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import { groupFitsUser, isDefaultStaffGroup } from "@/lib/access";
import { createUser, listUsers, removeStaffUser, sendUserLink } from "@/lib/users-api";
import { AccessPicker } from "@/components/admin/AccessPicker";
import { applyAccess, EMPTY_ACCESS, type AccessDraft } from "@/lib/admin-access";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import type { AccessGroup, Client, Project, User, UserAccessGroup } from "@/lib/types";
import { hashPassword, randomPassword } from "@/lib/password";

const empty = {
  name: "",
  email: "",
  password: "",
  title: "",
  phone: "",
  is_admin: false,
  must_change_password: true,
};

export function ConfigInternalUsersPage({ embedded = false }: { embedded?: boolean }) {
  const { realUser } = useAuth();
  const { t, tr, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<User[]>([]);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [memberships, setMemberships] = useState<UserAccessGroup[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [access, setAccess] = useState<AccessDraft>(EMPTY_ACCESS);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);

  async function load() {
    try {
      await dbReady;
      const rows = await listUsers();
      setPeople(rows.filter((p) => p.user_type !== "external"));
      setGroups((await db.select().from(schema.access_groups)) as AccessGroup[]);
      setMemberships((await db.select().from(schema.user_access_groups)) as UserAccessGroup[]);
      setProjects((await db.select().from(schema.projects)) as Project[]);
      setClients((await db.select().from(schema.clients)) as Client[]);
    } catch (err) {
      console.error("load users failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const internalGroups = useMemo(
    () => groups.filter((g) => groupFitsUser(g, "internal")),
    [groups],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => [p.name, p.email, p.title].some((v) => v?.toLowerCase().includes(q)));
  }, [people, query]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!realUser?.is_admin) return;
    setSaving(true);
    setFormError(null);
    const email = form.email.trim().toLowerCase();
    const name = form.name.trim();
    try {
      const created = await createUser({
        name,
        email,
        password: await hashPassword(form.password.trim() || randomPassword()),
        user_type: "internal",
        title: form.title.trim() || null,
        phone: form.phone.trim() || null,
        is_admin: form.is_admin,
        avatar_initials: initials(name),
        must_change_password: form.must_change_password,
      });
      const result = await applyAccess({ userId: created.id, clientId: 0, draft: access, locale });
      setNotice({
        tone: result.invite === "failed" ? "bad" : "ok",
        text: result.invite === "sent" ? t("cu.inviteSent", { email }) : result.invite === "local" ? t("cu.linkLocal") : result.invite === "failed" ? `${t("adm.inviteFailed")} ${tr(result.inviteError, "users.link.failed")}` : t("adm.accountCreated"),
      });
      await logActivity({
        action: "created user",
        details: `${name} (internal)`,
        userId: realUser.id,
      });
      setOpen(false);
      setForm(empty);
      await load();
    } catch (err) {
      console.error("create user failed", err);
      setFormError(tr(err, "users.error.createFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!realUser?.is_admin) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title={t("config.restricted")}
        description={t("config.restrictedDesc")}
      />
    );
  }

  function openCreate() {
    setForm({
      ...empty,
      password: randomPassword(),
    });
    setAccess({ ...EMPTY_ACCESS, groupIds: internalGroups.filter(isDefaultStaffGroup).map((g) => g.id) });
    setOpen(true);
  }

  async function onRemove() {
    if (!removing || !realUser) return;
    setSaving(true);
    try {
      await removeStaffUser(removing.id, realUser.id);
      await logActivity({ action: "deleted user", details: `${removing.name} (internal)`, userId: realUser.id });
      setRemoving(null);
      setNotice({ tone: "ok", text: t("adm.staffDeleted", { name: removing.name }) });
      await load();
    } catch (err) {
      setRemoving(null);
      setNotice({ tone: "bad", text: tr(err, "users.error.updateFailed") });
    } finally {
      setSaving(false);
    }
  }

  /** An invitation (a new account) or a password reset: the person gets a link by email to choose their password. */
  async function onSendLink(person: User, kind: "invite" | "reset") {
    setLinkBusy(`${kind}-${person.id}`);
    setNotice(null);
    try {
      const out = await sendUserLink(person.id, kind, locale);
      setNotice(out.local ? { tone: "bad", text: t("cu.linkLocal") } : { tone: "ok", text: t(kind === "invite" ? "cu.inviteSent" : "cu.resetSent", { email: out.email ?? person.email }) });
    } catch (err) {
      setNotice({ tone: "bad", text: tr(err, "users.link.failed") });
    } finally {
      setLinkBusy(null);
    }
  }

  return (
    <div>
      {embedded ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">{t("adm.staff.desc")}</p>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t("config.internal.new")}
          </Button>
        </div>
      ) : (
        <PageHeader
          eyebrow={t("nav.section.admin")}
          title={t("config.internal.title")}
          description={t("adm.staff.desc")}
          actions={
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t("config.internal.new")}
            </Button>
          }
        />
      )}

      <div>
        {notice ? <p className={cn("mb-4 rounded-lg border px-3 py-2 text-sm", notice.tone === "ok" ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10 text-destructive")}>{notice.text}</p> : null}
          <div className="relative mb-5 max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("people.search")}
              className="pl-9"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title={t("people.noMatch")}
              description={t("people.noMatchDesc")}
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <ul className="divide-y">
                {filtered.map((p) => {
                  const assigned = memberships
                    .filter((m) => m.user_id === p.id)
                    .map((m) => groups.find((g) => g.id === m.group_id)?.name)
                    .filter(Boolean);
                  return (
                    <li key={p.id} className="flex items-center transition-colors hover:bg-muted/50">
                      <Link
                        to={`/config/users/${p.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5"
                      >
                        <UserAvatar name={p.name} hint={p.avatar_initials} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {p.name}
                            {p.is_admin ? (
                              <span className="ml-2 text-[11px] font-medium text-primary">{t("nav.admin")}</span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.title || "—"} · {p.email}
                          </p>
                          {assigned.length > 0 && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{assigned.join(" · ")}</p>
                          )}
                        </div>
                        <StatusBadge value={p.is_active ? "active" : "inactive"} />
                      </Link>
                      <div className="flex shrink-0 items-center gap-0.5 pr-3">
                        <Button variant="ghost" size="icon-sm" title={t("cu.resendInvite")} aria-label={t("cu.resendInvite")} disabled={linkBusy !== null || !p.is_active} onClick={() => void onSendLink(p, "invite")}>
                          {linkBusy === `invite-${p.id}` ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                        </Button>
                        <Button variant="ghost" size="icon-sm" title={t("cu.resetPassword")} aria-label={t("cu.resetPassword")} disabled={linkBusy !== null || !p.is_active} onClick={() => void onSendLink(p, "reset")}>
                          {linkBusy === `reset-${p.id}` ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/admin?section=staffRights&user=${p.id}`}>{t("clients.access")}</Link>
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={t("adm.staffDelete")} aria-label={t("adm.staffDelete")} disabled={p.id === realUser?.id} onClick={() => setRemoving(p)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
      </div>

      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("adm.staffDeleteTitle", { name: removing?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("adm.staffDeleteBody")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t("people.cancel")}
            </Button>
            <Button variant="destructive" disabled={saving} onClick={() => void onRemove()}>
              <Trash2 className="size-4" />
              {t("adm.staffDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("config.internal.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreate} className="grid gap-4">
            <div className="space-y-1.5">
              <Label>{t("people.fullName")}</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("people.email")}</Label>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("people.titleField")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("people.phone")}</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("people.tempPassword")}</Label>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_admin}
                onChange={(e) => setForm({ ...form, is_admin: e.target.checked })}
              />
              {t("people.adminCheck")}
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.must_change_password}
                onChange={(e) => setForm({ ...form, must_change_password: e.target.checked })}
              />
              <span>
                {t("people.mustChange")}
                <span className="mt-0.5 block text-xs text-muted-foreground">{t("people.mustChangeHint")}</span>
              </span>
            </label>
            {form.is_admin ? (
              <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">{t("people.adminBanner")}</p>
            ) : (
              <AccessPicker groups={internalGroups} projects={projects} clients={clients} draft={access} onChange={setAccess} docsHint={t("adm.staffDocsHint")} />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("people.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("people.creating") : t("people.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
