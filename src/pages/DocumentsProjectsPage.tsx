import { nextProjectColor } from "@/lib/project-colors";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronsDownUp, ChevronsUpDown, Plus, Search } from "lucide-react";
import { db, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { logActivity } from "@/lib/activity";
import { projectSectionPath } from "@/lib/project-nav";
import {
  applyProjectFolder,
  emptyProjectForm,
  ProjectFormFields,
  projectInsertValues,
  useSharePointFolders,
  type ProjectFormValues,
} from "@/components/ProjectFormFields";
import { PageHeader } from "@/components/PageHeader";
import { ClientDrawer } from "@/components/ProjectCabinet";
import type { TaskLite } from "@/lib/project-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Client, Project } from "@/lib/types";

export function DocumentsProjectsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { clients, projects, selectedClientId, refresh } = useWorkspace();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProjectFormValues>(emptyProjectForm);
  const [clientId, setClientId] = useState<number | "">(selectedClientId ?? "");
  const [busy, setBusy] = useState(false);
  const folders = useSharePointFolders(open);
  const canCreate = Boolean(user?.is_admin || user?.user_type === "internal") && user?.view_as !== "client";
  // Drawers: the first client starts open; a search opens every drawer that has a match.
  const [openDrawers, setOpenDrawers] = useState<Record<number, boolean>>({});
  const [tasks, setTasks] = useState<TaskLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    db.select({ project_id: schema.project_tasks.project_id, status: schema.project_tasks.status })
      .from(schema.project_tasks)
      .then((rows) => !cancelled && setTasks(rows as TaskLite[]))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projects.length]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...clients]
      .sort((a, b) => a.company_name.localeCompare(b.company_name))
      .map((client) => ({
        client,
        jobs: projects
          .filter((p) => p.client_id === client.id)
          .filter((p) => {
            if (!q) return true;
            return (
              client.company_name.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              p.project_number.toLowerCase().includes(q) ||
              (p.city ?? "").toLowerCase().includes(q)
            );
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.jobs.length > 0 || (!q && projects.some((p) => p.client_id === group.client.id)));
  }, [clients, projects, query]);

  async function createProject() {
    if (!form.name.trim() || !clientId) return;
    setBusy(true);
    try {
      const [row] = await db.insert(schema.projects).values({ ...projectInsertValues(form, Number(clientId)), color: await nextProjectColor() }).returning();
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
        clientId: Number(clientId),
        userId: user?.id,
      });
      await applyProjectFolder({
        projectId: row.id,
        clientId: Number(clientId),
        projectName: form.name.trim(),
        folderMode: folders.folderMode,
        folderId: folders.folderId,
        folderName: folders.folderName,
        folderDrive: folders.folderDrive,
        folderChoices: folders.folderChoices,
      });
      setOpen(false);
      setForm(emptyProjectForm);
      await refresh();
      navigate(projectSectionPath(row.id, "documents"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("sp.projectsTitle")}
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setForm(emptyProjectForm);
                setClientId(selectedClientId ?? "");
                setOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("projects.new")}
            </Button>
          ) : null
        }
      />
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("sp.projectsSearch")} />
      </div>
      {groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("sp.projectsEmpty")}</p>
      ) : (
        <>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpenDrawers(Object.fromEntries(groups.map((g) => [g.client.id, true])))}>
              <ChevronsUpDown className="size-4" />
              {t("cab.expandAll")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpenDrawers(Object.fromEntries(groups.map((g) => [g.client.id, false])))}>
              <ChevronsDownUp className="size-4" />
              {t("cab.collapseAll")}
            </Button>
          </div>
          <div className="space-y-4">
            {groups.map(({ client, jobs }: { client: Client; jobs: Project[] }, i) => (
              <ClientDrawer
                key={client.id}
                client={client}
                jobs={jobs}
                tasks={tasks}
                open={openDrawers[client.id] ?? (query.trim() ? true : i === 0)}
                onToggle={() => setOpenDrawers((prev) => ({ ...prev, [client.id]: !(prev[client.id] ?? (query.trim() ? true : i === 0)) }))}
                noProjects={t("nav.noProjectsYet")}
              />
            ))}
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projects.new")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createProject();
            }}
          >
            <ProjectFormFields
              form={form}
              onChange={setForm}
              clients={clients}
              clientId={clientId}
              onClientId={setClientId}
              folderMode={folders.folderMode}
              onFolderMode={folders.setFolderMode}
              folderChoices={folders.folderChoices}
              folderId={folders.folderId}
              onFolderId={folders.setFolderId}
              folderName={folders.folderName}
              onFolderName={folders.setFolderName}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("clients.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !form.name.trim() || !clientId}>
                {busy ? t("clients.creating") : t("clients.createProject")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
