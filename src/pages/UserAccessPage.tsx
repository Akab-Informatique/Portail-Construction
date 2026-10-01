import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { ArrowLeft, Shield } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { MODULES, PROJECT_MODULES } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { Client, Permission, Project, User } from "@/lib/types";

type Flags = { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };

const EMPTY: Flags = { can_view: false, can_create: false, can_edit: false, can_delete: false };

function fromRow(row?: Permission): Flags {
  if (!row) return { ...EMPTY };
  return {
    can_view: row.can_view === 1,
    can_create: row.can_create === 1,
    can_edit: row.can_edit === 1,
    can_delete: row.can_delete === 1,
  };
}

export function UserAccessPage() {
  const { userId } = useParams();
  const id = Number(userId);
  const { user: me, can, refreshPermissions } = useAuth();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [scopeProject, setScopeProject] = useState<string>("global");
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  async function load() {
    // Always leave the loading state, even if a query fails, so the page
    // never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, id));
      if (!rows[0]) {
        setTarget(null);
        setLoading(false);
        return;
      }
      const perms = (await db
        .select()
        .from(schema.user_permissions)
        .where(eq(schema.user_permissions.user_id, id))) as Permission[];
      const jobs = (await db.select().from(schema.projects)) as Project[];
      const cos = (await db.select().from(schema.clients)) as Client[];
      setTarget(rows[0] as User);
      setPermissions(perms);
      setProjects(jobs);
      setClients(cos);
      setActive(rows[0].is_active === 1);
      setIsAdmin(rows[0].is_admin === 1);
      setLoading(false);
    } catch (err) {
      console.error("UserAccessPage load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const visibleProjects = useMemo(() => {
    if (!target) return [];
    if (target.user_type === "external") {
      // still show all so admin can grant a specific job
      return projects;
    }
    return projects;
  }, [target, projects]);

  const matrixModules = useMemo(() => {
    if (scopeProject === "global") return MODULES;
    return PROJECT_MODULES;
  }, [scopeProject]);

  function currentFlags(module: string): Flags {
    if (scopeProject === "global") {
      return fromRow(
        permissions.find((p) => p.module === module && p.scope_type === "global"),
      );
    }
    const pid = Number(scopeProject);
    return fromRow(
      permissions.find(
        (p) => p.module === module && p.scope_type === "project" && p.scope_id === pid,
      ),
    );
  }

  async function writeFlags(module: string, flags: Flags) {
    if (!target) return;
    setSaving(true);
    const scope_type = scopeProject === "global" ? "global" : "project";
    const scope_id = scopeProject === "global" ? 0 : Number(scopeProject);
    const existing = permissions.find(
      (p) => p.module === module && p.scope_type === scope_type && p.scope_id === scope_id,
    );
    const payload = {
      can_view: flags.can_view ? 1 : 0,
      can_create: flags.can_create ? 1 : 0,
      can_edit: flags.can_edit ? 1 : 0,
      can_delete: flags.can_delete ? 1 : 0,
    };
    if (existing) {
      await db
        .update(schema.user_permissions)
        .set(payload)
        .where(eq(schema.user_permissions.id, existing.id));
    } else {
      await db.insert(schema.user_permissions).values({
        user_id: target.id,
        module,
        scope_type,
        scope_id,
        ...payload,
      });
    }
    const perms = (await db
      .select()
      .from(schema.user_permissions)
      .where(eq(schema.user_permissions.user_id, target.id))) as Permission[];
    setPermissions(perms);
    if (me?.id === target.id) await refreshPermissions();
    setSaving(false);
  }

  async function toggleAccount(next: boolean) {
    if (!target) return;
    setActive(next);
    await db.update(schema.users).set({ is_active: next ? 1 : 0 }).where(eq(schema.users.id, target.id));
    setTarget({ ...target, is_active: next ? 1 : 0 });
  }

  async function toggleAdmin(next: boolean) {
    if (!target) return;
    setIsAdmin(next);
    await db.update(schema.users).set({ is_admin: next ? 1 : 0 }).where(eq(schema.users.id, target.id));
    setTarget({ ...target, is_admin: next ? 1 : 0 });
  }

  if (loading) return <PageSkeleton />;
  if (!target) {
    return (
      <EmptyState
        icon={<Shield className="size-5" />}
        title="User not found"
        description="This account may have been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/team">Back to people</Link>
          </Button>
        }
      />
    );
  }

  const allowed = me?.is_admin || can("users", "edit") || can("users", "view");
  if (!allowed) {
    return (
      <EmptyState
        icon={<Shield className="size-5" />}
        title="Restricted"
        description="You don’t have permission to manage access."
      />
    );
  }

  const canEdit = me?.is_admin || can("users", "edit");

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link to="/team">
          <ArrowLeft className="size-4" />
          People
        </Link>
      </Button>

      <PageHeader
        eyebrow="Access"
        title={target.name}
        description={`${target.email} · ${target.title || (target.user_type === "internal" ? "Employee" : "Client user")}`}
        actions={
          <>
            <UserAvatar name={target.name} hint={target.avatar_initials} />
            <StatusBadge value={target.user_type} />
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-medium">{t("people.activeAccount")}</p>
            <p className="text-xs text-muted-foreground">{t("people.activeHint")}</p>
          </div>
          <Switch checked={active} onCheckedChange={toggleAccount} disabled={!canEdit} />
        </div>
        {target.user_type === "internal" && (
          <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t("people.adminLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("people.adminHint")}</p>
            </div>
            <Switch checked={isAdmin} onCheckedChange={toggleAdmin} disabled={!canEdit} />
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="rounded-xl border border-primary/25 bg-primary/6 px-5 py-8 text-sm text-muted-foreground">
          {t("people.adminBanner")}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <Label>{t("people.scope")}</Label>
              <Select value={scopeProject} onValueChange={setScopeProject}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (all jobs)</SelectItem>
                  {visibleProjects.map((p) => {
                    const client = clients.find((c) => c.id === p.client_id);
                    return (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} · {client?.company_name ?? p.project_number}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {saving ? "Saving…" : "Changes save as you click."}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Module</th>
                  <th className="px-3 py-3 font-medium">View</th>
                  <th className="px-3 py-3 font-medium">Create</th>
                  <th className="px-3 py-3 font-medium">Edit</th>
                  <th className="px-3 py-3 font-medium">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {matrixModules.map((m) => {
                  const flags = currentFlags(m.id);
                  const set = (key: keyof Flags, value: boolean) => {
                    const next = { ...flags, [key]: value };
                    if (key !== "can_view" && value) next.can_view = true;
                    if (key === "can_view" && !value) {
                      next.can_create = false;
                      next.can_edit = false;
                      next.can_delete = false;
                    }
                    writeFlags(m.id, next);
                  };
                  return (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{t(`module.${m.id}` as "module.dashboard")}</p>
                        <p className="text-xs text-muted-foreground">{t(`module.${m.id}.desc` as "module.dashboard.desc")}</p>
                      </td>
                      {(["can_view", "can_create", "can_edit", "can_delete"] as const).map((k) => (
                        <td key={k} className="px-3 py-3">
                          <Checkbox
                            checked={flags[k]}
                            disabled={!canEdit}
                            onCheckedChange={(v) => set(k, v === true)}
                            aria-label={`${m.label} ${k.replace("can_", "")}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
