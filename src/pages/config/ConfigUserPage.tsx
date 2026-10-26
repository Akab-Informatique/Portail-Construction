import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { ArrowLeft, Shield } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { groupFitsUser, setUserClients, setUserGroups } from "@/lib/access";
import { initials } from "@/lib/format";
import { hashPassword } from "@/lib/password";
import { listUsers, updateUser } from "@/lib/users-api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { GroupPicker } from "./GroupPicker";
import type { AccessGroup, Client, User, UserAccessGroup, UserClient } from "@/lib/types";

export function ConfigUserPage() {
  const { userId } = useParams();
  const id = Number(userId);
  const { user: me, refreshPermissions } = useAuth();
  const { refresh } = useWorkspace();
  const { t, tr } = useI18n();

  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<User | null>(null);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [memberships, setMemberships] = useState<number[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [assignedClientIds, setAssignedClientIds] = useState<number[]>([]);
  const [linkedClientIds, setLinkedClientIds] = useState<number[]>([]);
  const [allClients, setAllClients] = useState(true);
  const [active, setActive] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState({ name: "", email: "", title: "", phone: "", password: "" });
  const [mustChange, setMustChange] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  async function load() {
    try {
      await dbReady;
      const people = await listUsers();
      const person = people.find((u) => u.id === id) ?? null;
      if (!person) {
        setTarget(null);
        return;
      }
      setTarget(person);
      setActive(person.is_active === 1);
      setIsAdmin(person.is_admin === 1);
      setAllClients(person.all_clients !== 0);
      setProfile({
        name: person.name,
        email: person.email,
        title: person.title ?? "",
        phone: person.phone ?? "",
        password: "",
      });
      setMustChange(person.must_change_password === 1);
      setGroups((await db.select().from(schema.access_groups)) as AccessGroup[]);
      const mems = (await db
        .select()
        .from(schema.user_access_groups)
        .where(eq(schema.user_access_groups.user_id, id))) as UserAccessGroup[];
      setMemberships(mems.map((m) => m.group_id));
      setClients((await db.select().from(schema.clients)) as Client[]);
      try {
        const assigned = (await db
          .select()
          .from(schema.user_clients)
          .where(eq(schema.user_clients.user_id, id))) as UserClient[];
        setAssignedClientIds(assigned.map((row) => row.client_id));
      } catch {
        setAssignedClientIds([]);
      }
      const links = await db.select().from(schema.client_users).where(eq(schema.client_users.user_id, id));
      setLinkedClientIds(links.map((row) => row.client_id));
    } catch (err) {
      console.error("user config load failed", err);
      setTarget(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const applicable = useMemo(
    () => (target ? groups.filter((g) => groupFitsUser(g, target.user_type)) : []),
    [groups, target],
  );

  async function toggleGroups(next: number[]) {
    setMemberships(next);
    await setUserGroups(id, next);
    if (me?.id === id) await refreshPermissions();
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const name = profile.name.trim();
      const email = profile.email.trim().toLowerCase();
      const updated = await updateUser({
        id: target.id,
        name,
        email,
        title: profile.title.trim() || null,
        phone: profile.phone.trim() || null,
        is_admin: isAdmin,
        is_active: active,
        avatar_initials: initials(name),
        password: profile.password.trim() ? await hashPassword(profile.password.trim()) : undefined,
        must_change_password: mustChange,
      });
      setTarget(updated);
      setProfile({
        name: updated.name,
        email: updated.email,
        title: updated.title ?? "",
        phone: updated.phone ?? "",
        password: "",
      });
      setProfileSaved(true);
    } catch (err) {
      setProfileError(tr(err, "users.error.updateFailed"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function toggleAccount(next: boolean) {
    if (!target) return;
    setActive(next);
    try {
      const updated = await updateUser({
        id: target.id,
        name: target.name,
        email: target.email,
        title: target.title,
        phone: target.phone,
        is_admin: isAdmin,
        is_active: next,
        avatar_initials: target.avatar_initials,
        must_change_password: mustChange,
      });
      setTarget(updated);
    } catch (err) {
      setActive(!next);
      setProfileError(tr(err, "users.error.updateFailed"));
    }
  }

  async function toggleAdmin(next: boolean) {
    if (!target) return;
    setIsAdmin(next);
    try {
      const updated = await updateUser({
        id: target.id,
        name: target.name,
        email: target.email,
        title: target.title,
        phone: target.phone,
        is_admin: next,
        is_active: active,
        avatar_initials: target.avatar_initials,
      });
      setTarget(updated);
    } catch (err) {
      setIsAdmin(!next);
      setProfileError(tr(err, "users.error.updateFailed"));
    }
  }

  async function toggleAllClients(next: boolean) {
    if (!target) return;
    setAllClients(next);
    await db.update(schema.users).set({ all_clients: next ? 1 : 0 }).where(eq(schema.users.id, target.id));
    setTarget({ ...target, all_clients: next ? 1 : 0 });
    if (me?.id === id) {
      await refreshPermissions();
      await refresh();
    }
  }

  async function toggleAssignedClients(next: number[]) {
    setAssignedClientIds(next);
    await setUserClients(id, next);
    if (me?.id === id) {
      await refreshPermissions();
      await refresh();
    }
  }

  if (loading) return <PageSkeleton />;
  if (!me?.is_admin) {
    return (
      <EmptyState
        icon={<Shield className="size-5" />}
        title={t("config.restricted")}
        description={t("config.restrictedDesc")}
      />
    );
  }
  if (!target) {
    return (
      <EmptyState
        icon={<Shield className="size-5" />}
        title={t("people.notFound")}
        description={t("people.notFoundDesc")}
        action={
          <Button asChild variant="outline">
            <Link to="/config/internal">{t("people.backToPeople")}</Link>
          </Button>
        }
      />
    );
  }

  const backTo = target.user_type === "external" ? "/config/clients" : "/config/internal";
  const linkedCompanies = clients.filter((c) => linkedClientIds.includes(c.id));

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link to={backTo}>
          <ArrowLeft className="size-4" />
          {target.user_type === "external" ? t("config.clients.title") : t("config.internal.title")}
        </Link>
      </Button>

      <PageHeader
        eyebrow={t("nav.setup")}
        title={target.name}
        description={`${target.email} · ${target.title || (target.user_type === "internal" ? t("people.employee") : t("people.clientUser"))}`}
        actions={
          <>
            <UserAvatar name={target.name} hint={target.avatar_initials} />
            <StatusBadge value={target.user_type} />
          </>
        }
      />

      <form onSubmit={saveProfile} className="mb-6 rounded-xl border bg-card p-5">
        <div className="mb-4">
          <p className="text-sm font-medium">{t("people.profile")}</p>
        </div>
        {profileError ? <p className="mb-3 text-sm text-destructive">{profileError}</p> : null}
        {profileSaved ? <p className="mb-3 text-sm text-primary">{t("people.saved")}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("people.fullName")}</Label>
            <Input required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("people.email")}</Label>
            <Input
              type="email"
              required
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("people.titleField")}</Label>
            <Input value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("people.phone")}</Label>
            <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>{t("people.newPassword")}</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={profile.password}
            onChange={(e) => setProfile({ ...profile, password: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t("people.newPasswordHint")}</p>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <Checkbox checked={mustChange} onCheckedChange={(v) => setMustChange(v === true)} className="mt-0.5" />
          <span>
            {t("people.mustChange")}
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("people.mustChangeHint")}</span>
          </span>
        </label>
        <div className="mt-4">
          <Button type="submit" disabled={savingProfile}>
            {savingProfile ? t("people.saving") : t("people.saveProfile")}
          </Button>
        </div>
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-medium">{t("people.activeAccount")}</p>
            <p className="text-xs text-muted-foreground">{t("people.activeHint")}</p>
          </div>
          <Switch checked={active} onCheckedChange={toggleAccount} />
        </div>
        {target.user_type === "internal" && (
          <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t("people.adminLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("people.adminHint")}</p>
            </div>
            <Switch checked={isAdmin} onCheckedChange={toggleAdmin} />
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="rounded-xl border border-primary/25 bg-primary/6 px-5 py-8 text-sm text-muted-foreground">
          {t("people.adminBanner")}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border bg-card p-5">
            <GroupPicker groups={applicable} selected={memberships} onChange={(ids) => void toggleGroups(ids)} />
          </div>
          <div className="rounded-xl border bg-card p-5">
            {target.user_type === "internal" ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium">{t("config.user.clients")}</p>
                  <p className="text-xs text-muted-foreground">{t("config.user.clientsHint")}</p>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{t("config.user.allClients")}</p>
                    <p className="text-xs text-muted-foreground">{t("config.user.allClientsHint")}</p>
                  </div>
                  <Switch checked={allClients} onCheckedChange={(v) => void toggleAllClients(v)} />
                </div>
                {!allClients && (
                  <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                    {clients.length === 0 ? (
                      <li className="px-2 py-2 text-sm text-muted-foreground">{t("config.user.noClients")}</li>
                    ) : (
                      clients.map((c) => {
                        const on = assignedClientIds.includes(c.id);
                        return (
                          <li key={c.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                              <Checkbox
                                checked={on}
                                onCheckedChange={(v) =>
                                  void toggleAssignedClients(
                                    v === true
                                      ? [...assignedClientIds, c.id]
                                      : assignedClientIds.filter((cid) => cid !== c.id),
                                  )
                                }
                              />
                              {c.company_name}
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">{t("config.user.linkedClients")}</p>
                {linkedCompanies.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">{t("config.user.noLinkedClients")}</p>
                ) : (
                  <ul className="mt-3 space-y-1 text-sm">
                    {linkedCompanies.map((c) => (
                      <li key={c.id}>{c.company_name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
