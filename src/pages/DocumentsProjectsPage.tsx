import { nextProjectColor } from "@/lib/project-colors";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
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
import { ClientFolders, ClientTab } from "@/components/ProjectCabinet";
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
  // The chosen drawer lives in the address (?client=) so Back and shared links land on it.
  const [params, setParams] = useSearchParams();
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

  // The cabinet holds ten drawers per page; the page follows the chosen client.
  const PER_PAGE = 10;
  const wanted = Number(params.get("client"));
  const current = groups.find((g) => g.client.id === wanted) ?? groups.find((g) => g.client.id === selectedClientId) ?? groups[0];
  const pages = Math.max(1, Math.ceil(groups.length / PER_PAGE));
  const [pageIndex, setPageIndex] = useState<number | null>(null);
  const currentIndex = current ? groups.indexOf(current) : 0;
  const page = Math.min(pageIndex ?? Math.floor(currentIndex / PER_PAGE), pages - 1);
  const visible = groups.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

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
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <nav aria-label={t("sp.projectsTitle")} className="frx-cabinet lg:sticky lg:top-20">
            {visible.map(({ client, jobs }: { client: Client; jobs: Project[] }) => (
              <ClientTab
                key={client.id}
                client={client}
                jobs={jobs}
                tasks={tasks}
                selected={client.id === current.client.id}
                onSelect={() => setParams({ client: String(client.id) }, { replace: true })}
              />
            ))}
            {pages > 1 ? (
              <div className="mt-2 flex items-center justify-between rounded-md bg-black/10 px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                <Button type="button" size="icon-sm" variant="ghost" disabled={page === 0} onClick={() => setPageIndex(page - 1)} aria-label={t("project.cal.prev")}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="tabular-nums">{t("cab.page", { n: page + 1, total: pages })}</span>
                <Button type="button" size="icon-sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPageIndex(page + 1)} aria-label={t("project.cal.next")}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
          </nav>
          <ClientFolders key={current.client.id} client={current.client} jobs={current.jobs} tasks={tasks} noProjects={t("nav.noProjectsYet")} />
        </div>
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
