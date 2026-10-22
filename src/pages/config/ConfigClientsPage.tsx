import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { eq } from "drizzle-orm";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { deleteClientCascade } from "@/lib/delete-client";
import { useWorkspace } from "@/lib/workspace";
import { initials } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { groupFitsUser, isDefaultClientGroup, setUserGroups } from "@/lib/access";
import { GroupPicker } from "./GroupPicker";
import { GroupsEditor } from "./GroupsEditor";
import type { AccessGroup, Client, Project, User } from "@/lib/types";
import { hashPassword, randomPassword } from "@/lib/password";

const emptyClient = {
  name: "",
  company_name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
  status: "active",
};

const emptyUser = {
  name: "",
  email: "",
  password: "",
  title: "",
  phone: "",
  is_primary: false,
  groupIds: [] as number[],
};

export function ConfigClientsPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { refresh } = useWorkspace();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [links, setLinks] = useState<{ client_id: number; user_id: number; is_primary: number }[]>([]);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [query, setQuery] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyClient);
  const [inviteFor, setInviteFor] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [userForm, setUserForm] = useState(emptyUser);
  const [saving, setSaving] = useState(false);

  async function load() {
    await dbReady;
    setClients((await db.select().from(schema.clients)) as Client[]);
    setProjects((await db.select().from(schema.projects)) as Project[]);
    setPeople((await db.select().from(schema.users)) as User[]);
    const cu = await db.select().from(schema.client_users);
    setLinks(cu.map((r) => ({ client_id: r.client_id, user_id: r.user_id, is_primary: r.is_primary })));
    setGroups((await db.select().from(schema.access_groups)) as AccessGroup[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const externalGroups = useMemo(
    () => groups.filter((g) => groupFitsUser(g, "external")),
    [groups],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.company_name, c.name, c.city, c.email].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [clients, query]);

  function openCreate() {
    setEditing(null);
    setForm(emptyClient);
    setClientOpen(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      name: c.name,
      company_name: c.company_name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      zip: c.zip ?? "",
      notes: c.notes ?? "",
      status: c.status,
    });
    setClientOpen(true);
  }

  async function onSaveClient(e: FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim() || !form.name.trim()) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      company_name: form.company_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      zip: form.zip.trim() || null,
      notes: form.notes.trim() || null,
      status: form.status,
    };
    if (editing) {
      await db.update(schema.clients).set(payload).where(eq(schema.clients.id, editing.id));
      await logActivity({
        action: "updated client",
        details: payload.company_name,
        clientId: editing.id,
        userId: user?.id,
      });
    } else {
      const [row] = await db.insert(schema.clients).values(payload).returning();
      await logActivity({
        action: "created client",
        details: row.company_name,
        clientId: row.id,
        userId: user?.id,
      });
    }
    setSaving(false);
    setClientOpen(false);
    await load();
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteFor || !userForm.name.trim() || !userForm.email.trim()) return;
    setSaving(true);
    try {
      const email = userForm.email.trim().toLowerCase();
      await db.insert(schema.users).values({
        name: userForm.name.trim(),
        email,
        password: await hashPassword(userForm.password.trim() || randomPassword()),
        user_type: "external",
        title: userForm.title.trim() || null,
        phone: userForm.phone.trim() || null,
        is_active: 1,
        is_admin: 0,
        avatar_initials: initials(userForm.name.trim()),
        locale: "en",
        theme: "light",
        all_clients: 0,
      });
      const createdRows = (await db.select().from(schema.users).where(eq(schema.users.email, email))) as User[];
      const created = createdRows[0];
      if (!created) throw new Error("User was not saved");
      await db.insert(schema.client_users).values({
        client_id: inviteFor.id,
        user_id: created.id,
        is_primary: userForm.is_primary ? 1 : 0,
      });
      if (userForm.groupIds.length) await setUserGroups(created.id, userForm.groupIds);
      await logActivity({
        action: "added client user",
        details: created.name,
        clientId: inviteFor.id,
        userId: user?.id,
      });
      setInviteFor(null);
      setUserForm(emptyUser);
      await load();
    } catch (err) {
      console.error("invite user failed", err);
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteClient() {
    if (!deleting) return;
    setSaving(true);
    try {
      await deleteClientCascade(deleting.id);
      await logActivity({
        action: "deleted client",
        details: deleting.company_name,
        userId: user?.id,
      });
      setDeleting(null);
      await load();
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!user?.is_admin) {
    return (
      <EmptyState
        icon={<Building2 className="size-5" />}
        title={t("config.restricted")}
        description={t("config.restrictedDesc")}
      />
    );
  }

  return (
    <div>
      {embedded ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("config.clients.title")}</p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t("clients.new")}
          </Button>
        </div>
      ) : (
        <PageHeader
          eyebrow={t("config.eyebrow")}
          title={t("config.clients.title")}
          actions={
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t("clients.new")}
            </Button>
          }
        />
      )}

      <Tabs defaultValue="companies" className="gap-5">
        <TabsList>
          <TabsTrigger value="companies">{t("config.clients.tab.companies")}</TabsTrigger>
          <TabsTrigger value="groups">{t("config.clients.tab.groups")}</TabsTrigger>
        </TabsList>

        <TabsContent value="companies">
      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("clients.search")}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title={clients.length === 0 ? t("clients.empty.title") : t("clients.noMatches")}
          description={clients.length === 0 ? t("clients.empty.desc") : t("clients.tryDifferent")}
          action={
            clients.length === 0 ? (
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                {t("clients.new")}
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4">
          {filtered.map((c) => {
            const jobs = projects.filter((p) => p.client_id === c.id);
            const members = links
              .filter((l) => l.client_id === c.id)
              .map((l) => ({
                ...l,
                person: people.find((p) => p.id === l.user_id),
              }))
              .filter((l) => l.person);
            return (
              <Card key={c.id} className="gap-0 py-0">
                <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-lg font-semibold tracking-tight">{c.company_name}</p>
                      <StatusBadge value={c.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {c.name}
                      {c.city ? ` · ${c.city}` : ""}
                      {c.email ? ` · ${c.email}` : ""}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">{jobs.length}</span>{" "}
                      {jobs.length === 1 ? t("clients.projectCount", { n: jobs.length }) : t("clients.projectCount_plural", { n: jobs.length })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/clients/${c.id}`}>{t("nav.clientDashboard")}</Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                      <Pencil className="size-3.5" />
                      {t("config.clients.edit")}
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleting(c)}>
                      <Trash2 className="size-3.5" />
                      {t("config.clients.delete")}
                    </Button>
                  </div>
                </div>
                <div className="border-t px-5 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {t("config.clients.users")}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setInviteFor(c);
                        setUserForm({
                          ...emptyUser,
                          groupIds: externalGroups.filter(isDefaultClientGroup).map((g) => g.id),
                        });
                      }}
                    >
                      <Plus className="size-3.5" />
                      {t("clients.invite")}
                    </Button>
                  </div>
                  {members.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">{t("clients.noUsers")}</p>
                  ) : (
                    <ul className="divide-y">
                      {members.map((m) => (
                        <li key={m.user_id} className="flex items-center gap-3 py-2">
                          <UserAvatar name={m.person!.name} hint={m.person!.avatar_initials} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {m.person!.name}
                              {m.is_primary ? (
                                <span className="ml-2 text-[11px] font-medium text-primary">{t("clients.primary")}</span>
                              ) : null}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">{m.person!.email}</p>
                          </div>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/config/users/${m.user_id}`}>{t("clients.access")}</Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
        </TabsContent>

        <TabsContent value="groups">
          <GroupsEditor compact audience="external" />
        </TabsContent>
      </Tabs>

      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("config.clients.edit") : t("clients.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSaveClient} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.company")} required>
                <Input
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  required
                />
              </Field>
              <Field label={t("clients.primaryContact")} required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.email")}>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label={t("clients.phone")}>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            <Field label={t("clients.street")}>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("clients.city")}>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label={t("clients.province")}>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </Field>
              <Field label={t("clients.postal")}>
                <Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
              </Field>
            </div>
            <Field label={t("clients.status")}>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("status.active")}</SelectItem>
                  <SelectItem value="prospect">{t("status.prospect")}</SelectItem>
                  <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("clients.notes")}>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClientOpen(false)}>
                {t("clients.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("clients.saving") : editing ? t("config.clients.save") : t("clients.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("config.clients.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("config.clients.deleteDesc", { name: deleting?.company_name ?? "" })}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              {t("clients.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void onDeleteClient()}>
              {saving ? t("clients.saving") : t("config.clients.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(inviteFor)}
        onOpenChange={(o) => {
          if (!o) setInviteFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("clients.inviteTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onInvite} className="grid gap-4">
            <Field label={t("clients.fullName")} required>
              <Input
                required
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
              />
            </Field>
            <Field label={t("clients.email")} required>
              <Input
                type="email"
                required
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.titleField")}>
                <Input value={userForm.title} onChange={(e) => setUserForm({ ...userForm, title: e.target.value })} />
              </Field>
              <Field label={t("clients.phone")}>
                <Input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} />
              </Field>
            </div>
            <Field label={t("clients.tempPassword")}>
              <Input
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={userForm.is_primary}
                onChange={(e) => setUserForm({ ...userForm, is_primary: e.target.checked })}
              />
              {t("clients.markPrimary")}
            </label>
            <GroupPicker
              groups={externalGroups}
              selected={userForm.groupIds}
              onChange={(groupIds) => setUserForm({ ...userForm, groupIds })}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteFor(null)}>
                {t("clients.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("clients.inviting") : t("clients.invite")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
