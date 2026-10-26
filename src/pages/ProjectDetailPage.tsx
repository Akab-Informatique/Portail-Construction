import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { eq } from "drizzle-orm";
import { FolderKanban, Pencil } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { getAccessibleProjectIds } from "@/lib/access";
import { withProjectMoney } from "@/lib/project-money";
import { visibleProjectModules } from "@/lib/permissions";
import { isProjectSection, projectSectionPath } from "@/lib/project-nav";
import { useI18n } from "@/lib/i18n";
import { syncAutoNotes } from "@/lib/task-activity";
import type { Client, ModuleId, Project, User } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { ProjectTopNav } from "@/components/ProjectTopNav";
import { PunchRuleChip } from "@/components/PunchRule";
import { PunchRuleEditor } from "@/components/project/PunchRuleEditor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  applyProjectFolder,
  formFromProject,
  ProjectFormFields,
  projectInsertValues,
  useSharePointFolders,
  type ProjectFormValues,
} from "@/components/ProjectFormFields";
import { ProjectOverview } from "@/components/project/sections/ProjectOverview";
import { ProjectDocuments } from "@/components/project/sections/ProjectDocuments";
import { ProjectSchedule } from "@/components/project/sections/ProjectSchedule";
import { ProjectNotes } from "@/components/project/sections/ProjectNotes";
import { ProjectForms } from "@/components/project/sections/ProjectForms";
import { ProjectSafety } from "@/components/project/sections/ProjectSafety";
import { ProjectQrt } from "@/components/project/sections/ProjectQrt";
import { ProjectBilling } from "@/components/project/sections/ProjectBilling";

/**
 * One project, seven sections across the top: Overview, Documentation, Schedule, Notes, SST, QRT, and
 * Quotes and invoices. This page only loads the project and draws the frame; each section owns its own data.
 */
export function ProjectDetailPage() {
  const { projectId, section: sectionParam } = useParams();
  const id = Number(projectId);
  const navigate = useNavigate();
  const { user, permissions } = useAuth();
  const { t } = useI18n();
  const section: ModuleId = isProjectSection(sectionParam) ? sectionParam : "dashboard";

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [members, setMembers] = useState<{ user_id: number; role: string }[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormValues | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const editFolders = useSharePointFolders(editOpen, id);

  const load = useCallback(async () => {
    // Always leave the loading state, even if a query fails, so the page never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
      const reach = await getAccessibleProjectIds(user);
      if (!rows[0] || (reach && !reach.includes(id))) {
        setProject(null);
        return;
      }
      const [clients, users, mems] = await Promise.all([
        db.select().from(schema.clients).where(eq(schema.clients.id, rows[0].client_id)),
        db.select().from(schema.users),
        db.select().from(schema.project_members).where(eq(schema.project_members.project_id, id)),
      ]);
      setProject((await withProjectMoney([rows[0] as Project]))[0]);
      setClient((clients[0] as Client) ?? null);
      setPeople(users as User[]);
      setMembers(mems.map((m) => ({ user_id: m.user_id, role: m.role })));
    } catch (err) {
      console.error("ProjectDetailPage load failed", err);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdminUser = Boolean(user?.is_admin) && user?.view_as !== "client";
  const { locale } = useI18n();
  useEffect(() => {
    if (project && isAdminUser) void syncAutoNotes(project, t as never, locale).catch(() => 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, isAdminUser]);

  const allowed = useMemo(() => visibleProjectModules(user, permissions, id), [user, permissions, id]);
  useEffect(() => {
    if (allowed.length && !allowed.includes(section)) navigate(projectSectionPath(id, allowed[0]), { replace: true });
  }, [allowed, section, id, navigate]);

  if (loading) return <PageSkeleton />;
  if (!project) {
    return (
      <EmptyState
        icon={<FolderKanban className="size-5" />}
        title={t("projects.notFound")}
        description={t("projects.notFoundDesc")}
        action={
          <Button asChild variant="outline">
            <Link to="/documents/projects">{t("nav.allProjects")}</Link>
          </Button>
        }
      />
    );
  }

  const shared = { project, client, people, members, reload: load };
  const isAdmin = Boolean(user?.is_admin);

  return (
    <div>
      <ProjectTopNav project={project} backLabel={client?.company_name || t("nav.allProjects")} />

      <PageHeader
        eyebrow={project.project_number}
        title={project.name}
        description={project.description || project.city || undefined}
        actions={
          <>
            <PunchRuleChip project={project} onClick={isAdmin ? () => setRuleOpen(true) : undefined} />
            <StatusBadge value={project.status} />
            <StatusBadge value={project.phase} />
            {isAdmin || user?.user_type === "internal" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditForm(formFromProject(project));
                  setEditOpen(true);
                }}
              >
                <Pencil className="size-4" />
                {t("projects.edit")}
              </Button>
            ) : null}
          </>
        }
      />

      {section === "dashboard" && <ProjectOverview {...shared} />}
      {section === "documents" && <ProjectDocuments {...shared} />}
      {section === "tasks" && <ProjectSchedule {...shared} />}
      {section === "notes" && <ProjectNotes {...shared} />}
      {section === "forms" && <ProjectForms {...shared} />}
      {section === "safety" && <ProjectSafety {...shared} />}
      {section === "qrt" && <ProjectQrt {...shared} />}
      {section === "project_billing" && <ProjectBilling {...shared} />}

      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("punch.geo.title")}</DialogTitle>
          </DialogHeader>
          <PunchRuleEditor
            project={project}
            onSave={async (next) => {
              await db
                .update(schema.projects)
                .set({
                  geo_lat: next.geo_lat,
                  geo_lng: next.geo_lng,
                  geo_radius_m: next.geo_radius_m,
                  require_geofence: next.require_geofence,
                })
                .where(eq(schema.projects.id, id));
              setProject({ ...project, ...next });
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projects.edit")}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setEditSaving(true);
                  try {
                    const values = projectInsertValues(editForm, project.client_id, { spent: project.spent, sort_order: project.sort_order });
                    await db
                      .update(schema.projects)
                      .set({
                        name: values.name,
                        project_number: values.project_number,
                        description: values.description,
                        status: values.status,
                        phase: values.phase,
                        project_type: values.project_type,
                        address: values.address,
                        city: values.city,
                        start_date: values.start_date,
                        end_date: values.end_date,
                        budget: values.budget,
                      })
                      .where(eq(schema.projects.id, id));
                    await applyProjectFolder({
                      projectId: id,
                      clientId: project.client_id,
                      projectName: editForm.name.trim(),
                      folderMode: editFolders.folderMode,
                      folderId: editFolders.folderId,
                      folderName: editFolders.folderName,
                      folderDrive: editFolders.folderDrive,
                      folderChoices: editFolders.folderChoices,
                    });
                    setEditOpen(false);
                    await load();
                  } finally {
                    setEditSaving(false);
                  }
                })();
              }}
            >
              <ProjectFormFields
                form={editForm}
                onChange={setEditForm}
                folderMode={editFolders.folderMode}
                onFolderMode={editFolders.setFolderMode}
                folderChoices={editFolders.folderChoices}
                folderId={editFolders.folderId}
                onFolderId={editFolders.setFolderId}
                folderName={editFolders.folderName}
                onFolderName={editFolders.setFolderName}
                assignedName={editFolders.assignedName}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  {t("clients.cancel")}
                </Button>
                <Button type="submit" disabled={editSaving || !editForm.name.trim()}>
                  {editSaving ? t("clients.saving") : t("projects.save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
