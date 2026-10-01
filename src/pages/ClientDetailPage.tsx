import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import {
  ArrowLeft,
  FolderKanban,
  MapPin,
  Plus,
  Users,
  Mail,
  Phone,
  LayoutDashboard,
} from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { initials, money, percent } from "@/lib/format";
import { PROJECT_PHASES, PROJECT_STATUSES, PROJECT_TYPES } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { NumberTicker } from "@/components/ui/number-ticker";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import type { Client, Project, User } from "@/lib/types";
import { assignProjectFolder, callSharePoint, loadAllFolders, type SpItem } from "@/lib/sharepoint";
import { getSharePointSettings, sharepointReady } from "@/lib/settings";

const projectFormEmpty = {
  name: "",
  project_number: "",
  description: "",
  status: "planning",
  phase: "preconstruction",
  project_type: "Commercial",
  address: "",
  city: "",
  start_date: "",
  end_date: "",
  budget: "",
};

const userFormEmpty = {
  name: "",
  email: "",
  password: "client123",
  title: "",
  phone: "",
  is_primary: false,
};

export function ClientDetailPage() {
  const { clientId } = useParams();
  const id = Number(clientId);
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const { t, locale } = useI18n();

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<(User & { is_primary: number })[]>([]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [pForm, setPForm] = useState(projectFormEmpty);
  const [uForm, setUForm] = useState(userFormEmpty);
  const [saving, setSaving] = useState(false);
  const [folderMode, setFolderMode] = useState<"later" | "existing" | "create">("existing");
  const [folderChoices, setFolderChoices] = useState<SpItem[]>([]);
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderDrive, setFolderDrive] = useState("");

  async function load() {
    // Always leave the loading state, even if a query fails, so the page
    // never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
      if (!rows[0]) {
        setClient(null);
        setLoading(false);
        return;
      }
      const jobs = (await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.client_id, id))) as Project[];
      const links = await db
        .select()
        .from(schema.client_users)
        .where(eq(schema.client_users.client_id, id));
      const users = (await db.select().from(schema.users)) as User[];
      const attached = links
        .map((l) => {
          const u = users.find((x) => x.id === l.user_id);
          return u ? { ...u, is_primary: l.is_primary } : null;
        })
        .filter(Boolean) as (User & { is_primary: number })[];
      setClient(rows[0] as Client);
      setProjects(jobs);
      setPeople(attached);
      setLoading(false);
    } catch (err) {
      console.error("ClientDetailPage load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!projectOpen) return;
    void (async () => {
      try {
        const cfg = await getSharePointSettings();
        if (!sharepointReady(cfg)) return;
        const listed = await callSharePoint<{ items: SpItem[]; driveId?: string }>("list", {
          driveId: cfg.drive_id,
        });
        setFolderChoices((listed.items ?? []).filter((item) => item.isFolder));
        setFolderDrive(listed.driveId || cfg.drive_id);
        const linked = await loadAllFolders();
        const unused = (listed.items ?? []).filter(
          (item) => item.isFolder && !linked.some((f) => f.sp_item_id === item.id),
        );
        if (unused[0]) setFolderId(unused[0].id);
        else if (listed.items?.find((i) => i.isFolder)) setFolderId(listed.items.find((i) => i.isFolder)!.id);
      } catch {
        setFolderChoices([]);
      }
    })();
  }, [projectOpen]);

  async function createProject(e: FormEvent) {
    e.preventDefault();
    if (!pForm.name.trim()) return;
    setSaving(true);
    const number =
      pForm.project_number.trim() ||
      `FOR-${new Date().getFullYear().toString().slice(2)}${String(Math.floor(Math.random() * 90) + 10)}`;
    const [row] = await db
      .insert(schema.projects)
      .values({
        client_id: id,
        name: pForm.name.trim(),
        project_number: number,
        description: pForm.description.trim() || null,
        status: pForm.status,
        phase: pForm.phase,
        project_type: pForm.project_type,
        address: pForm.address.trim() || null,
        city: pForm.city.trim() || null,
        start_date: pForm.start_date || null,
        end_date: pForm.end_date || null,
        budget: Number(pForm.budget) || 0,
        spent: 0,
        sort_order: Date.now() % 100000,
      })
      .returning();
    if (user) {
      await db.insert(schema.project_members).values({
        project_id: row.id,
        user_id: user.id,
        role: user.is_admin ? "Administrator" : "Project Manager",
      });
    }
    await logActivity({
      action: "created project",
      details: row.name,
      projectId: row.id,
      clientId: id,
      userId: user?.id,
    });
    try {
      const cfg = await getSharePointSettings();
      if (sharepointReady(cfg) && folderMode !== "later") {
        if (folderMode === "create") {
          const name = folderName.trim() || pForm.name.trim();
          const created = await callSharePoint<{ driveId: string; folder: { id: string; name: string } }>("mkdir", {
            name,
          });
          await assignProjectFolder({
            projectId: row.id,
            clientId: id,
            name: created.folder.name,
            spItemId: created.folder.id,
            spDriveId: created.driveId,
            path: created.folder.name,
          });
        } else if (folderId) {
          const picked = folderChoices.find((f) => f.id === folderId);
          await assignProjectFolder({
            projectId: row.id,
            clientId: id,
            name: picked?.name || pForm.name.trim(),
            spItemId: folderId,
            spDriveId: folderDrive || cfg.drive_id,
            path: picked?.name || pForm.name.trim(),
          });
        }
      }
    } catch {
      /* folder assignment is optional if SharePoint is down */
    }
    setSaving(false);
    setProjectOpen(false);
    setPForm(projectFormEmpty);
    setFolderMode("existing");
    setFolderName("");
    await load();
    navigate(`/projects/${row.id}`);
  }

  async function createClientUser(e: FormEvent) {
    e.preventDefault();
    if (!uForm.name.trim() || !uForm.email.trim()) return;
    setSaving(true);
    const [created] = await db
      .insert(schema.users)
      .values({
        name: uForm.name.trim(),
        email: uForm.email.trim().toLowerCase(),
        password: uForm.password || "client123",
        user_type: "external",
        title: uForm.title.trim() || null,
        phone: uForm.phone.trim() || null,
        is_active: 1,
        is_admin: 0,
        avatar_initials: initials(uForm.name.trim()),
        locale: "en",
        theme: "light",
        all_clients: 0,
      })
      .returning();
    await db.insert(schema.client_users).values({
      client_id: id,
      user_id: created.id,
      is_primary: uForm.is_primary ? 1 : 0,
    });
    const modules = ["dashboard", "calendar", "documents", "punch", "team", "billing"];
    for (const project of projects) {
      for (const module of modules) {
        await db.insert(schema.user_permissions).values({
          user_id: created.id,
          module,
          scope_type: "project",
          scope_id: project.id,
          can_view: 1,
          can_create: 0,
          can_edit: 0,
          can_delete: 0,
        });
      }
    }
    await logActivity({
      action: "added client user",
      details: created.name,
      clientId: id,
      userId: user?.id,
    });
    setSaving(false);
    setUserOpen(false);
    setUForm(userFormEmpty);
    await load();
  }

  if (loading) return <PageSkeleton />;
  if (!client) {
    return (
      <EmptyState
        icon={<FolderKanban className="size-5" />}
        title={t("clients.notFound")}
        description={t("clients.notFoundDesc")}
        action={
          <Button asChild variant="outline">
            <Link to="/clients">{t("clients.back")}</Link>
          </Button>
        }
      />
    );
  }

  const budget = projects.reduce((s, p) => s + p.budget, 0);
  const spent = projects.reduce((s, p) => s + p.spent, 0);
  const canCreateProject = can("clients", "create") || user?.user_type === "internal";
  const canInvite = can("users", "create") || user?.is_admin || user?.user_type === "internal";

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link to="/clients">
          <ArrowLeft className="size-4" />
          {t("clients.back")}
        </Link>
      </Button>

      <PageHeader
        eyebrow={t("clients.eyebrowOne")}
        title={client.company_name}
        description={client.notes || `${client.name} · ${[client.city, client.state].filter(Boolean).join(", ")}`}
        actions={
          <>
            <StatusBadge value={client.status} />
            {canCreateProject && (
              <Button onClick={() => setProjectOpen(true)}>
                <Plus className="size-4" />
                {t("clients.newProject")}
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">
            <LayoutDashboard className="size-3.5" />
            {t("clients.tab.dashboard")}
          </TabsTrigger>
          <TabsTrigger value="projects">
            <FolderKanban className="size-3.5" />
            {t("clients.tab.projects")}
          </TabsTrigger>
          <TabsTrigger value="people">
            <Users className="size-3.5" />
            {t("clients.tab.people")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={t("clients.stat.projects")}
              value={projects.length}
              hint={t("clients.stat.activeHint", { n: projects.filter((p) => p.status === "active").length })}
            />
            <Stat
              label={t("clients.stat.contract")}
              value={budget}
              isMoney
              hint={t("clients.stat.spentHint", { pct: percent(spent, budget) })}
            />
            <Stat
              label={t("clients.stat.spent")}
              value={spent}
              isMoney
              hint={t("clients.stat.remaining", { amount: money(Math.max(budget - spent, 0), locale) })}
            />
            <Stat
              label={t("clients.stat.external")}
              value={people.length}
              hint={t("clients.stat.primaryHint", { n: people.filter((p) => p.is_primary).length })}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]">
            <Card className="py-0">
              <CardHeader className="border-b px-5 py-4">
                <CardTitle className="text-base">{t("clients.account")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 px-5 py-5 text-sm">
                <Row icon={Users} label={t("clients.primaryContact")} value={client.name} />
                <Row icon={Mail} label={t("clients.email")} value={client.email || "—"} />
                <Row icon={Phone} label={t("clients.phone")} value={client.phone || "—"} />
                <Row
                  icon={MapPin}
                  label={t("clients.address")}
                  value={[client.address, client.city, client.state, client.zip].filter(Boolean).join(", ") || "—"}
                />
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardHeader className="border-b px-5 py-4">
                <CardTitle className="text-base">{t("clients.widgetBay")}</CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-8 text-sm text-muted-foreground">
                {t("clients.widgetCopy")}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="projects" className="mt-5">
          {projects.length === 0 ? (
            <EmptyState
              icon={<FolderKanban className="size-5" />}
              title={t("clients.noProjects")}
              description={t("clients.noProjectsDesc")}
              action={
                canCreateProject ? (
                  <Button onClick={() => setProjectOpen(true)}>
                    <Plus className="size-4" />
                    {t("clients.newProject")}
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-4">
              {projects.map((p) => {
                const used = percent(p.spent, p.budget);
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} className="group">
                    <Card className="gap-0 py-0 transition-colors group-hover:border-primary/35">
                      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-display text-lg font-semibold tracking-tight">{p.name}</p>
                            <StatusBadge value={p.status} />
                            <StatusBadge value={p.phase} />
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {p.project_number}
                            {p.city ? ` · ${p.city}` : ""}
                            {p.project_type ? ` · ${p.project_type}` : ""}
                          </p>
                        </div>
                        <div className="w-full sm:w-48">
                          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                            <span className="tabular-nums">{money(p.spent, locale)}</span>
                            <span className="tabular-nums">{money(p.budget, locale)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(used, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="people" className="mt-5">
          <div className="mb-4 flex justify-end">
            {canInvite && (
              <Button onClick={() => setUserOpen(true)}>
                <Plus className="size-4" />
                {t("clients.invite")}
              </Button>
            )}
          </div>
          {people.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title={t("clients.noUsers")}
              description={t("clients.noUsersDesc")}
              action={
                canInvite ? (
                  <Button onClick={() => setUserOpen(true)}>
                    <Plus className="size-4" />
                    {t("clients.invite")}
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <ul className="divide-y">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3.5">
                    <UserAvatar name={p.name} hint={p.avatar_initials} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {p.name}
                        {p.is_primary ? (
                          <span className="ml-2 text-[11px] font-medium text-primary">{t("clients.primary")}</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.title || t("clients.clientUser")} · {p.email}
                      </p>
                    </div>
                    <StatusBadge value={p.is_active ? "active" : "inactive"} />
                    {(user?.is_admin || can("users", "edit")) && (
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/team/${p.id}`}>{t("clients.access")}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("clients.newProject")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={createProject} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.projectName")} required>
                <Input
                  value={pForm.name}
                  onChange={(e) => setPForm({ ...pForm, name: e.target.value })}
                  required
                />
              </Field>
              <Field label={t("clients.jobNumber")}>
                <Input
                  placeholder={t("clients.jobNumberHint")}
                  value={pForm.project_number}
                  onChange={(e) => setPForm({ ...pForm, project_number: e.target.value })}
                />
              </Field>
            </div>
            <Field label={t("clients.description")}>
              <Textarea
                rows={2}
                value={pForm.description}
                onChange={(e) => setPForm({ ...pForm, description: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.status")}>
                <Select value={pForm.status} onValueChange={(v) => setPForm({ ...pForm, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {t(`status.${s.value}` as MessageKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("clients.phase")}>
                <Select value={pForm.phase} onValueChange={(v) => setPForm({ ...pForm, phase: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_PHASES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {t(`status.${s.value}` as MessageKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={t("clients.type")}>
              <Select
                value={pForm.project_type}
                onValueChange={(v) => setPForm({ ...pForm, project_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((typ) => (
                    <SelectItem key={typ} value={typ}>
                      {t(`type.${typ}` as MessageKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.address")}>
                <Input
                  value={pForm.address}
                  onChange={(e) => setPForm({ ...pForm, address: e.target.value })}
                />
              </Field>
              <Field label={t("clients.city")}>
                <Input value={pForm.city} onChange={(e) => setPForm({ ...pForm, city: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("clients.start")}>
                <Input
                  type="date"
                  value={pForm.start_date}
                  onChange={(e) => setPForm({ ...pForm, start_date: e.target.value })}
                />
              </Field>
              <Field label={t("clients.end")}>
                <Input
                  type="date"
                  value={pForm.end_date}
                  onChange={(e) => setPForm({ ...pForm, end_date: e.target.value })}
                />
              </Field>
              <Field label={t("clients.budgetCad")}>
                <Input
                  type="number"
                  min="0"
                  value={pForm.budget}
                  onChange={(e) => setPForm({ ...pForm, budget: e.target.value })}
                />
              </Field>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{t("sp.assignFolder")}</p>
              <p className="text-xs text-muted-foreground">{t("sp.assignFolderHint")}</p>
              <Select value={folderMode} onValueChange={(v) => setFolderMode(v as typeof folderMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">{t("sp.assignExisting")}</SelectItem>
                  <SelectItem value="create">{t("sp.assignCreate")}</SelectItem>
                  <SelectItem value="later">{t("sp.pickLater")}</SelectItem>
                </SelectContent>
              </Select>
              {folderMode === "existing" ? (
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {folderChoices.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {folderMode === "create" ? (
                <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder={t("sp.folderName")} />
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectOpen(false)}>
                {t("clients.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("clients.creating") : t("clients.createProject")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={userOpen} onOpenChange={setUserOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("clients.inviteTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={createClientUser} className="grid gap-4">
            <Field label={t("clients.fullName")} required>
              <Input
                value={uForm.name}
                onChange={(e) => setUForm({ ...uForm, name: e.target.value })}
                required
              />
            </Field>
            <Field label={t("clients.email")} required>
              <Input
                type="email"
                value={uForm.email}
                onChange={(e) => setUForm({ ...uForm, email: e.target.value })}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.titleField")}>
                <Input value={uForm.title} onChange={(e) => setUForm({ ...uForm, title: e.target.value })} />
              </Field>
              <Field label={t("clients.phone")}>
                <Input value={uForm.phone} onChange={(e) => setUForm({ ...uForm, phone: e.target.value })} />
              </Field>
            </div>
            <Field label={t("clients.tempPassword")}>
              <Input
                value={uForm.password}
                onChange={(e) => setUForm({ ...uForm, password: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={uForm.is_primary}
                onChange={(e) => setUForm({ ...uForm, is_primary: e.target.checked })}
              />
              {t("clients.markPrimary")}
            </label>
            <p className="text-xs text-muted-foreground">{t("clients.inviteHint")}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUserOpen(false)}>
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

function Stat({
  label,
  value,
  hint,
  isMoney,
}: {
  label: string;
  value: number;
  hint: string;
  isMoney?: boolean;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-[13px] font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="font-display text-3xl font-semibold tabular-nums tracking-tight">
          {isMoney ? (
            <>
              $<NumberTicker value={Math.round(value / 1000)} className="font-display" />k
            </>
          ) : (
            <NumberTicker value={value} className="font-display" />
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p>{value}</p>
      </div>
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
