import { nextProjectColor } from "@/lib/project-colors";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, ChevronDown, ChevronRight, FolderKanban, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

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
        <div className="space-y-3">
          {groups.map(({ client, jobs }: { client: Client; jobs: Project[] }) => {
            const isOpen = !collapsed[client.id];
            return (
              <Card key={client.id} className="gap-0 overflow-hidden p-0">
                <div className="flex items-center gap-1 border-b pr-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left hover:bg-muted/40"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [client.id]: !prev[client.id] }))}
                    aria-expanded={isOpen}
                  >
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{client.company_name}</p>
                      <p className="text-xs text-muted-foreground">{t("sp.projectCount", { n: jobs.length })}</p>
                    </div>
                  </button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/clients/${client.id}`}>
                      {t("dash.viewAll")}
                      <ChevronRight className="size-4" />
                    </Link>
                  </Button>
                </div>
                {isOpen ? (
                  jobs.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">{t("nav.noProjectsYet")}</p>
                  ) : (
                    <ul className="divide-y">
                      {jobs.map((job) => (
                        <li key={job.id}>
                          <Link
                            to={projectSectionPath(job.id, "documents")}
                            className="flex items-center gap-3 py-3 pr-4 pl-10 transition-colors hover:bg-muted/50"
                          >
                            <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-medium">{job.name}</p>
                                <StatusBadge value={job.status} />
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {job.project_number}
                                {job.city ? ` · ${job.city}` : ""}
                              </p>
                            </div>
                            <span className="hidden text-xs text-muted-foreground sm:inline">{t("sp.openDocs")}</span>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </Card>
            );
          })}
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
