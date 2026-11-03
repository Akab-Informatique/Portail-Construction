import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { Building2, ChevronDown, ChevronRight, HardHat, KeyRound, Plus, Search, Shield, Trash2, UserRound, Users } from "lucide-react";
import { db, dbReady, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { listUsers } from "@/lib/users-api";
import { groupFitsUser, setUserGroups, writeGroupFlags } from "@/lib/access";
import {
  createGroup,
  deleteGroup,
  NO_FLAGS,
  setAllClients,
  setGroupMembers,
  setGroupProjects,
  setUserCompanies,
  setUserProjects,
  writeUserFlags,
  type Flags,
} from "@/lib/admin-access";
import { logActivity } from "@/lib/activity";
import type {
  AccessGroup,
  AccessGroupPermission,
  Client,
  GroupProject,
  Permission,
  Project,
  User,
  UserAccessGroup,
  UserClient,
} from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { AccessSummary } from "@/components/admin/AccessSummary";
import { PermMatrix } from "@/components/admin/PermMatrix";
import { ProjectPicker } from "@/components/admin/parts";
import { ReportPicker } from "@/components/admin/ReportPicker";
import { SubjectDocs } from "@/components/admin/SubjectDocs";
import { GroupPicker } from "@/pages/config/GroupPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Audience = "internal" | "external";
type Sel = { kind: "user" | "group" | "company"; id: number } | null;
type Tab = "summary" | "groups" | "menu" | "projects" | "docs" | "reports" | "users";

type Data = {
  users: User[];
  clients: Client[];
  projects: Project[];
  groups: AccessGroup[];
  memberships: UserAccessGroup[];
  groupPerms: AccessGroupPermission[];
  groupProjects: GroupProject[];
  userPerms: Permission[];
  members: { project_id: number; user_id: number }[];
  userClients: UserClient[];
  clientUsers: { client_id: number; user_id: number }[];
};

const EMPTY: Data = { users: [], clients: [], projects: [], groups: [], memberships: [], groupPerms: [], groupProjects: [], userPerms: [], members: [], userClients: [], clientUsers: [] };

const flagsOf = (rows: { can_view: number; can_create: number; can_edit: number; can_delete: number }[] | undefined): Flags =>
  rows?.length
    ? { can_view: rows.some((r) => r.can_view === 1), can_create: rows.some((r) => r.can_create === 1), can_edit: rows.some((r) => r.can_edit === 1), can_delete: rows.some((r) => r.can_delete === 1) }
    : { ...NO_FLAGS };

/**
 * Administration › Access rights. One page for people and groups: pick who on the left, then set everything they can reach on
 * the right: the sidebar pages and what they may do in them, the projects, the documentation folders, the reports. A group
 * carries the same four things, and everyone in it gets them on top of what they were given alone.
 */
export function AdminAccessPage({ audience, embedded = false }: { audience: Audience; embedded?: boolean }) {
  const { user, realUser } = useAuth();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<"people" | "groups">("people");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });
  const [confirmDelete, setConfirmDelete] = useState<AccessGroup | null>(null);
  const staff = audience === "internal";

  const load = useCallback(async () => {
    await dbReady;
    const [users, clients, projects, groups, memberships, groupPerms, groupProjects, userPerms, members, userClients, clientUsers] = await Promise.all([
      listUsers(),
      db.select().from(schema.clients),
      db.select().from(schema.projects),
      db.select().from(schema.access_groups),
      db.select().from(schema.user_access_groups),
      db.select().from(schema.access_group_permissions),
      db.select().from(schema.group_projects),
      db.select().from(schema.user_permissions),
      db.select({ project_id: schema.project_members.project_id, user_id: schema.project_members.user_id }).from(schema.project_members),
      db.select().from(schema.user_clients),
      db.select({ client_id: schema.client_users.client_id, user_id: schema.client_users.user_id }).from(schema.client_users),
    ]);
    setData({
      users,
      clients: clients as Client[],
      projects: projects as Project[],
      groups: groups as AccessGroup[],
      memberships: memberships as UserAccessGroup[],
      groupPerms: groupPerms as AccessGroupPermission[],
      groupProjects: groupProjects as GroupProject[],
      userPerms: userPerms as Permission[],
      members,
      userClients: userClients as UserClient[],
      clientUsers,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load]);

  // The selection lives in the address, so a link from the Clients or Staff page opens straight on the right person.
  const sel: Sel = useMemo(() => {
    const u = Number(params.get("user"));
    const g = Number(params.get("group"));
    const c = Number(params.get("company"));
    if (u) return { kind: "user", id: u };
    if (g) return { kind: "group", id: g };
    if (c) return { kind: "company", id: c };
    return null;
  }, [params]);

  function select(next: Sel, nextTab: Tab | null = null) {
    setTab(nextTab);
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const k of ["user", "group", "company"]) out.delete(k);
        if (next) out.set(next.kind, String(next.id));
        return out;
      },
      { replace: true },
    );
  }

  const groups = useMemo(() => data.groups.filter((g) => groupFitsUser(g, audience)).sort((a, b) => a.name.localeCompare(b.name)), [data.groups, audience]);
  const people = useMemo(
    () => data.users.filter((u) => (staff ? u.user_type !== "external" : u.user_type === "external")).sort((a, b) => a.name.localeCompare(b.name)),
    [data.users, staff],
  );

  // A link to a person opens the list they are in.
  useEffect(() => {
    if (sel?.kind === "group") setList("groups");
    else if (sel) setList("people");
  }, [sel?.kind, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <PageSkeleton />;
  if (!realUser?.is_admin) return <EmptyState icon={<Shield className="size-5" />} title={t("config.restricted")} description={t("config.restrictedDesc")} />;

  const q = query.trim().toLowerCase();
  const matches = (...v: (string | null | undefined)[]) => !q || v.some((x) => x?.toLowerCase().includes(q));
  const companies = [...data.clients].sort((a, b) => a.company_name.localeCompare(b.company_name));
  const usersOf = (clientId: number) => people.filter((p) => data.clientUsers.some((l) => l.client_id === clientId && l.user_id === p.id));

  async function onCreateGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupForm.name.trim()) return;
    const row = await createGroup({ name: groupForm.name.trim(), description: groupForm.description.trim() || null, audience });
    await logActivity({ action: "created access group", details: row.name, userId: user?.id });
    setGroupForm({ name: "", description: "" });
    setNewGroup(false);
    await load();
    setList("groups");
    select({ kind: "group", id: row.id });
  }

  async function onDeleteGroup() {
    if (!confirmDelete) return;
    await deleteGroup(confirmDelete.id);
    await logActivity({ action: "deleted access group", details: confirmDelete.name, userId: user?.id });
    setConfirmDelete(null);
    select(null);
    await load();
  }

  const selectedUser = sel?.kind === "user" ? people.find((p) => p.id === sel.id) ?? null : null;
  const selectedGroup = sel?.kind === "group" ? groups.find((g) => g.id === sel.id) ?? null : null;
  const selectedCompany = sel?.kind === "company" ? data.clients.find((c) => c.id === sel.id) ?? null : null;

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm text-muted-foreground">{t(staff ? "adm.access.staffDesc" : "adm.access.clientsDesc")}</p>
          <Button onClick={() => setNewGroup(true)}>
            <Plus className="size-4" />
            {t("config.groups.new")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <Card className="gap-3 p-3 lg:max-h-[76vh] lg:overflow-y-auto">
          <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1">
            {(
              [
                ["people", staff ? t("adm.list.staff") : t("adm.list.companies"), staff ? HardHat : Building2, staff ? people.length : companies.length],
                ["groups", t("adm.list.groups"), Users, groups.length],
              ] as const
            ).map(([id, label, Icon, n]) => (
              <button
                key={id}
                type="button"
                onClick={() => setList(id)}
                className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-all", list === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="size-4" />
                {label}
                <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input className="pl-9" value={query} placeholder={t(list === "groups" ? "adm.searchGroup" : staff ? "pda.searchStaff" : "pda.searchClient")} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {list === "groups" ? (
            <ul className="space-y-1">
              {groups.filter((g) => matches(g.name, g.description)).map((g) => {
                const n = data.memberships.filter((m) => m.group_id === g.id).length;
                const on = sel?.kind === "group" && sel.id === g.id;
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => select({ kind: "group", id: g.id })} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors", on ? "bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-muted")}>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Users className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{g.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{t("config.groups.members", { n })}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {groups.length === 0 ? <li className="px-2 py-4 text-sm text-muted-foreground">{t(staff ? "config.groups.empty.internalDesc" : "config.groups.empty.externalDesc")}</li> : null}
            </ul>
          ) : staff ? (
            <ul className="space-y-1">
              {people.filter((p) => matches(p.name, p.email, p.title)).map((p) => {
                const on = sel?.kind === "user" && sel.id === p.id;
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => select({ kind: "user", id: p.id })} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors", on ? "bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-muted")}>
                      <UserAvatar name={p.name} hint={p.avatar_initials} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{p.is_admin ? t("adm.fullAccessShort") : p.title || p.email}</span>
                      </span>
                      {!p.is_active ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{t("cu.inactive")}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-1">
              {companies
                .map((c) => ({ c, users: usersOf(c.id) }))
                .filter(({ c, users }) => matches(c.company_name, c.name) || users.some((u) => matches(u.name, u.email)))
                .map(({ c, users }) => {
                  const open = Boolean(q) || (sel?.kind === "company" && sel.id === c.id) || users.some((u) => sel?.kind === "user" && sel.id === u.id);
                  const on = sel?.kind === "company" && sel.id === c.id;
                  return (
                    <li key={c.id}>
                      <div className={cn("flex items-center rounded-lg transition-colors", on ? "bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-muted")}>
                        <button type="button" onClick={() => select({ kind: "company", id: c.id })} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                            <Building2 className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{c.company_name}</span>
                            <span className="block text-[11px] text-muted-foreground">{t("adm.usersCount", { n: users.length })}</span>
                          </span>
                        </button>
                        {users.length ? (
                          <span className="pr-2 text-muted-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
                        ) : null}
                      </div>
                      {open ? (
                        <ul className="mt-0.5 mb-1 ml-5 space-y-0.5 border-l pl-2">
                          {users.filter((u) => !q || matches(c.company_name, c.name) || matches(u.name, u.email)).map((u) => {
                            const onUser = sel?.kind === "user" && sel.id === u.id;
                            return (
                              <li key={u.id}>
                                <button type="button" onClick={() => select({ kind: "user", id: u.id })} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors", onUser ? "bg-primary/15 font-medium" : "hover:bg-muted")}>
                                  <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>

        <div className="min-w-0">
          {selectedUser ? (
            <PersonEditor key={`u${selectedUser.id}`} person={selectedUser} staff={staff} data={data} groups={groups} tab={tab} setTab={setTab} reload={load} />
          ) : selectedGroup ? (
            <GroupEditor key={`g${selectedGroup.id}`} group={selectedGroup} staff={staff} data={data} people={people} tab={tab} setTab={setTab} reload={load} onDelete={() => setConfirmDelete(selectedGroup)} />
          ) : selectedCompany ? (
            <CompanyEditor key={`c${selectedCompany.id}`} client={selectedCompany} users={usersOf(selectedCompany.id)} tab={tab} setTab={setTab} onPick={(id) => select({ kind: "user", id })} />
          ) : (
            <Card className="flex min-h-64 flex-col items-center justify-center gap-2 p-10 text-center">
              <KeyRound className="size-6 text-muted-foreground" />
              <p className="font-medium">{t(staff ? "adm.pick.staff" : "adm.pick.client")}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t("adm.pick.hint")}</p>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={newGroup} onOpenChange={setNewGroup}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onCreateGroup}>
            <DialogHeader>
              <DialogTitle>{t("config.groups.new")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <p className="text-sm text-muted-foreground">{t("adm.group.intro")}</p>
              <div className="space-y-1.5">
                <Label>{t("config.groups.name")}</Label>
                <Input required value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("config.groups.description")}</Label>
                <Textarea rows={2} value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewGroup(false)}>
                {t("people.cancel")}
              </Button>
              <Button type="submit">{t("config.groups.create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("config.groups.delete")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("adm.group.deleteBody", { name: confirmDelete?.name ?? "" })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t("people.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void onDeleteGroup()}>
              <Trash2 className="size-4" />
              {t("config.groups.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The tab strip every editor uses. */
function Tabs({ tabs, value, onChange }: { tabs: { id: Tab; label: string; count?: number }[]; value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          type="button"
          onClick={() => onChange(tb.id)}
          className={cn("flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", value === tb.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {tb.label}
          {tb.count !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{tb.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Heading({ children, sub, right }: { children: React.ReactNode; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="font-display text-2xl leading-tight tracking-wide">{children}</div>
        {sub ? <p className="text-sm text-muted-foreground">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** A person: the groups they belong to, then what is theirs alone (on top of the groups): menu, projects, folders, reports. */
function PersonEditor({
  person,
  staff,
  data,
  groups,
  tab,
  setTab,
  reload,
}: {
  person: User;
  staff: boolean;
  data: Data;
  groups: AccessGroup[];
  tab: Tab | null;
  setTab: (t: Tab) => void;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { user: me, refreshPermissions } = useAuth();
  const admin = person.is_admin === 1;
  const tabs: { id: Tab; label: string }[] = [
    { id: "summary", label: t("adm.tab.summary") },
    { id: "groups", label: t("adm.tab.groups") },
    ...(staff ? [{ id: "menu" as Tab, label: t("adm.tab.menu") }] : []),
    { id: "projects", label: t("adm.tab.projects") },
    { id: "docs", label: t("adm.tab.docs") },
    ...(staff ? [{ id: "reports" as Tab, label: t("adm.tab.reports") }] : []),
  ];
  const active: Tab = tab && tabs.some((x) => x.id === tab) ? tab : "summary";
  const myGroupIds = data.memberships.filter((m) => m.user_id === person.id).map((m) => m.group_id);
  const companyIds = data.clientUsers.filter((l) => l.user_id === person.id).map((l) => l.client_id);

  async function done() {
    await reload();
    if (me?.id === person.id) await refreshPermissions();
  }

  // Projects given by the person's groups.
  const viaGroup = new Set(data.groupProjects.filter((g) => myGroupIds.includes(g.group_id)).map((g) => g.project_id));
  const own = data.members.filter((m) => m.user_id === person.id).map((m) => m.project_id);
  const myCompanies = data.userClients.filter((u) => u.user_id === person.id).map((u) => u.client_id);
  const scope = staff ? data.projects : data.projects.filter((p) => companyIds.includes(p.client_id));

  const inherited = useMemo(() => {
    const out: Record<string, Flags> = {};
    for (const gid of myGroupIds) {
      for (const row of data.groupPerms.filter((p) => p.group_id === gid)) {
        const prev = out[row.module] ?? NO_FLAGS;
        out[row.module] = { can_view: prev.can_view || row.can_view === 1, can_create: prev.can_create || row.can_create === 1, can_edit: prev.can_edit || row.can_edit === 1, can_delete: prev.can_delete || row.can_delete === 1 };
      }
    }
    return out;
  }, [data.groupPerms, myGroupIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownFlags = useMemo(() => {
    const out: Record<string, Flags> = {};
    for (const row of data.userPerms.filter((p) => p.user_id === person.id && p.scope_type === "global")) out[row.module] = flagsOf([row]);
    return out;
  }, [data.userPerms, person.id]);

  return (
    <div className="grid gap-4">
      <Card className="gap-4 p-5">
        <Heading
          sub={[person.title, person.email].filter(Boolean).join(" · ")}
          right={
            <Button variant="outline" size="sm" asChild>
              <Link to={`/config/users/${person.id}`}>{t("adm.openProfile")}</Link>
            </Button>
          }
        >
          <span className="flex items-center gap-3">
            <UserAvatar name={person.name} hint={person.avatar_initials} />
            {person.name}
          </span>
        </Heading>
        {!staff && companyIds.length ? (
          <p className="text-xs text-muted-foreground">{t("adm.memberOf", { names: data.clients.filter((c) => companyIds.includes(c.id)).map((c) => c.company_name).join(", ") })}</p>
        ) : null}
      </Card>

      {admin ? (
        <div className="rounded-xl border border-primary/25 bg-primary/6 px-5 py-8 text-sm text-muted-foreground">{t("people.adminBanner")}</div>
      ) : (
        <>
          <Tabs tabs={tabs} value={active} onChange={setTab} />
          {active === "summary" ? (
            <AccessSummary
              staff={staff}
              personId={person.id}
              clientIds={companyIds}
              groupIds={myGroupIds}
              ownFlags={ownFlags}
              inherited={inherited}
              projectCount={
                staff && person.all_clients !== 0
                  ? "all"
                  : new Set([...own, ...viaGroup, ...data.projects.filter((p) => myCompanies.includes(p.client_id)).map((p) => p.id)].filter((id) => scope.some((p) => p.id === id))).size
              }
              projectTotal={scope.length}
              goto={(next) => setTab(next)}
            />
          ) : null}
          {active === "groups" ? (
            <Card className="gap-4 p-5">
              <p className="text-sm text-muted-foreground">{t("adm.person.groupsHelp")}</p>
              <GroupPicker
                groups={groups}
                selected={myGroupIds}
                onChange={(ids) => void setUserGroups(person.id, ids).then(done)}
              />
            </Card>
          ) : null}
          {active === "menu" ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t("adm.menu.personHelp")}</p>
              <PermMatrix flags={ownFlags} inherited={inherited} onChange={(module, next) => void writeUserFlags(person.id, module, next).then(done)} />
            </div>
          ) : null}
          {active === "projects" ? (
            <Card className="gap-4 p-5">
              {staff ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{t("config.user.allClients")}</p>
                    <p className="text-xs text-muted-foreground">{t("config.user.allClientsHint")}</p>
                  </div>
                  <Switch checked={person.all_clients !== 0} onCheckedChange={(v) => void setAllClients(person.id, v).then(done)} />
                </div>
              ) : null}
              {staff && person.all_clients !== 0 ? null : (
                <>
                  <p className="text-sm text-muted-foreground">{t(staff ? "adm.projects.staffHelp" : "adm.projects.clientHelp")}</p>
                  <ProjectPicker
                    projects={scope}
                    clients={data.clients}
                    selected={own}
                    locked={viaGroup}
                    onChange={(ids) => void setUserProjects(person.id, ids, scope.map((p) => p.id), staff ? "Staff" : "Client").then(done)}
                    companies={staff ? myCompanies : undefined}
                    onCompaniesChange={staff ? (ids) => void setUserCompanies(person.id, ids).then(done) : undefined}
                    maxHeight="max-h-[55vh]"
                  />
                </>
              )}
            </Card>
          ) : null}
          {active === "docs" ? (
            <SubjectDocs
              subject={staff ? { clientId: 0, userId: person.id } : { clientId: companyIds[0] ?? 0, userId: person.id }}
              cap={staff ? undefined : { clientId: companyIds[0] ?? 0, userId: null }}
            />
          ) : null}
          {active === "reports" ? <ReportPicker subject={{ type: "user", id: person.id }} viaGroups={myGroupIds} /> : null}
          {!staff && companyIds.length > 1 && active === "docs" ? <p className="text-xs text-muted-foreground">{t("adm.docs.multiCompany", { name: data.clients.find((c) => c.id === companyIds[0])?.company_name ?? "" })}</p> : null}
        </>
      )}
    </div>
  );
}

/** A group: who is in it, and what everyone in it gets. */
function GroupEditor({
  group,
  staff,
  data,
  people,
  tab,
  setTab,
  reload,
  onDelete,
}: {
  group: AccessGroup;
  staff: boolean;
  data: Data;
  people: User[];
  tab: Tab | null;
  setTab: (t: Tab) => void;
  reload: () => Promise<void>;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const memberIds = data.memberships.filter((m) => m.group_id === group.id).map((m) => m.user_id);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "groups", label: t("adm.tab.members"), count: memberIds.length },
    ...(staff ? [{ id: "menu" as Tab, label: t("adm.tab.menu") }] : []),
    { id: "projects", label: t("adm.tab.projects"), count: data.groupProjects.filter((g) => g.group_id === group.id).length },
    { id: "docs", label: t("adm.tab.docs") },
    ...(staff ? [{ id: "reports" as Tab, label: t("adm.tab.reports") }] : []),
  ];
  const active: Tab = tab && tabs.some((x) => x.id === tab) ? tab : "groups";
  const candidates = people.filter((p) => p.is_active === 1 && p.is_admin !== 1);
  const shown = candidates.filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });
  const flags = useMemo(() => {
    const out: Record<string, Flags> = {};
    for (const row of data.groupPerms.filter((p) => p.group_id === group.id)) out[row.module] = flagsOf([row]);
    return out;
  }, [data.groupPerms, group.id]);
  const companyOf = (userId: number) => data.clients.find((c) => data.clientUsers.some((l) => l.user_id === userId && l.client_id === c.id))?.company_name;

  return (
    <div className="grid gap-4">
      <Card className="gap-3 p-5">
        <Heading
          sub={group.description ?? undefined}
          right={
            <Button variant="outline" size="sm" className="text-destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              {t("config.groups.delete")}
            </Button>
          }
        >
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Users className="size-5" />
            </span>
            <GroupName group={group} onSaved={reload} />
          </span>
        </Heading>
      </Card>
      <Tabs tabs={tabs} value={active} onChange={setTab} />

      {active === "groups" ? (
        <Card className="gap-3 p-5">
          <p className="text-sm text-muted-foreground">{t("adm.group.membersHelp")}</p>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input className="pl-9" value={query} placeholder={t("people.search")} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul className="max-h-[52vh] divide-y overflow-y-auto rounded-lg border">
            {shown.map((p) => {
              const on = memberIds.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        void setGroupMembers(group.id, v === true ? [...memberIds, p.id] : memberIds.filter((id) => id !== p.id), candidates.map((c) => c.id)).then(reload)
                      }
                    />
                    <UserAvatar name={p.name} hint={p.avatar_initials} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{(!staff && companyOf(p.id)) || p.title || p.email}</span>
                    </span>
                  </label>
                </li>
              );
            })}
            {shown.length === 0 ? <li className="p-4 text-sm text-muted-foreground">{t("people.noMatch")}</li> : null}
          </ul>
        </Card>
      ) : null}
      {active === "menu" ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("adm.menu.groupHelp")}</p>
          <PermMatrix flags={flags} onChange={(module, next) => void writeGroupFlags(group.id, module, next).then(reload)} />
        </div>
      ) : null}
      {active === "projects" ? (
        <Card className="gap-3 p-5">
          <p className="text-sm text-muted-foreground">{t(staff ? "adm.projects.groupStaffHelp" : "adm.projects.groupClientHelp")}</p>
          <ProjectPicker
            projects={data.projects}
            clients={data.clients}
            selected={data.groupProjects.filter((g) => g.group_id === group.id).map((g) => g.project_id)}
            onChange={(ids) => void setGroupProjects(group.id, ids).then(reload)}
            maxHeight="max-h-[55vh]"
          />
        </Card>
      ) : null}
      {active === "docs" ? (
        <div className="grid gap-3">
          {!staff ? <p className="text-sm text-muted-foreground">{t("adm.docs.groupClientHelp")}</p> : null}
          <SubjectDocs subject={{ clientId: -1, userId: null, groupId: group.id }} />
        </div>
      ) : null}
      {active === "reports" ? <ReportPicker subject={{ type: "group", id: group.id }} /> : null}
    </div>
  );
}

function GroupName({ group, onSaved }: { group: AccessGroup; onSaved: () => Promise<void> }) {
  return (
    <input
      key={group.id}
      defaultValue={group.name}
      aria-label="name"
      className="min-w-0 rounded-md border border-transparent bg-transparent px-1 font-display text-2xl leading-tight tracking-wide hover:border-input focus:border-ring focus:outline-none"
      onBlur={(e) => {
        const name = e.target.value.trim();
        if (name && name !== group.name) void db.update(schema.access_groups).set({ name }).where(eq(schema.access_groups.id, group.id)).then(onSaved);
      }}
    />
  );
}

/** A client company: its own level on the documentation (its users can never have more), and a way into each of its users. */
function CompanyEditor({ client, users, tab, setTab, onPick }: { client: Client; users: User[]; tab: Tab | null; setTab: (t: Tab) => void; onPick: (id: number) => void }) {
  const { t } = useI18n();
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "docs", label: t("adm.tab.docs") },
    { id: "users", label: t("adm.tab.users"), count: users.length },
  ];
  const active: Tab = tab && tabs.some((x) => x.id === tab) ? tab : "docs";
  return (
    <div className="grid gap-4">
      <Card className="gap-3 p-5">
        <Heading sub={[client.name, client.email].filter(Boolean).join(" · ")}>
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Building2 className="size-5" />
            </span>
            {client.company_name}
          </span>
        </Heading>
      </Card>
      <Tabs tabs={tabs} value={active} onChange={setTab} />
      {active === "docs" ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("adm.docs.companyHelp")}</p>
          <SubjectDocs subject={{ clientId: client.id, userId: null }} />
        </div>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          {users.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t("clients.noUsers")}</p> : null}
          <ul className="divide-y">
            {users.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => onPick(u.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/40">
                  <UserAvatar name={u.name} hint={u.avatar_initials} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{u.email}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

