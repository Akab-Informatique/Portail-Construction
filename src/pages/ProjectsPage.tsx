import { nextProjectColor } from "@/lib/project-colors";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, FolderKanban, GripVertical, MapPin, MoreHorizontal, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import {
  BOARD_COLORS,
  boardColor,
  createBoardColumn,
  deleteBoardColumn,
  persistProjectMove,
  renameBoardColumn,
  reorderBoardColumns,
  updateBoardColumnColor,
} from "@/lib/board";
import { logActivity } from "@/lib/activity";
import { BOARD_COLLAPSE_KEY } from "@/lib/constants";
import { money, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoardColumn, Project } from "@/lib/types";
import { db, schema } from "../db";
import {
  applyProjectFolder,
  emptyProjectForm,
  ProjectFormFields,
  projectInsertValues,
  useSharePointFolders,
  type ProjectFormValues,
} from "@/components/ProjectFormFields";

type DragPayload =
  | { type: "card"; projectId: number; fromSlug: string }
  | { type: "column"; columnId: number };

function readCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(BOARD_COLLAPSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {BOARD_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            aria-label={c.id}
            aria-pressed={value === c.id}
            className={cn(
              "size-7 rounded-full border-2 transition-transform",
              c.swatch,
              value === c.id ? "scale-110 border-foreground" : "border-transparent hover:scale-105",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const {
    projects,
    clients,
    columns,
    selectedClient,
    selectedClientId,
    setProjects,
    setColumns,
    refresh,
    ready,
  } = useWorkspace();

  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [overSlug, setOverSlug] = useState<string | null>(null);
  const [overBefore, setOverBefore] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<{ id: number; after: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("slate");
  const [renameTarget, setRenameTarget] = useState<BoardColumn | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameColor, setRenameColor] = useState("slate");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [projectOpen, setProjectOpen] = useState(false);
  const [pForm, setPForm] = useState<ProjectFormValues>(emptyProjectForm);
  const [newClientId, setNewClientId] = useState<number | "">(selectedClientId ?? "");
  const folderState = useSharePointFolders(projectOpen);

  useEffect(() => {
    localStorage.setItem(BOARD_COLLAPSE_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  const scoped = useMemo(() => {
    const list =
      user?.is_admin && selectedClientId
        ? projects.filter((p) => p.client_id === selectedClientId)
        : projects;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, selectedClientId, user?.is_admin]);

  const byColumn = useMemo(() => {
    const map: Record<string, Project[]> = {};
    for (const col of columns) map[col.slug] = [];
    const fallback = columns[0]?.slug;
    const ordered = [...scoped].sort((a, b) => (a.sort_order ?? a.id) - (b.sort_order ?? b.id) || a.id - b.id);
    for (const p of ordered) {
      const key = map[p.status] ? p.status : fallback;
      if (key) map[key].push(p);
    }
    return map;
  }, [scoped, columns]);

  const canEdit = Boolean(user?.is_admin || user?.user_type === "internal");
  const title = selectedClient && user?.is_admin ? selectedClient.company_name : t("projects.title");
  const allCollapsed = columns.length > 0 && columns.every((c) => collapsed[c.slug]);

  function toggleColumn(slug: string) {
    setCollapsed((prev) => ({ ...prev, [slug]: !prev[slug] }));
  }

  function toggleAll() {
    if (allCollapsed) {
      setCollapsed({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const col of columns) next[col.slug] = true;
    setCollapsed(next);
  }

  async function moveProject(projectId: number, toSlug: string, beforeId?: number) {
    const dest = [...(byColumn[toSlug] ?? [])].filter((p) => p.id !== projectId);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    if (beforeId) {
      const idx = dest.findIndex((p) => p.id === beforeId);
      dest.splice(idx < 0 ? dest.length : idx, 0, { ...project, status: toSlug });
    } else {
      dest.push({ ...project, status: toSlug });
    }

    const updates = dest.map((p, i) => ({ id: p.id, status: toSlug, sort_order: i }));
    setProjects((prev) =>
      prev.map((p) => {
        const next = updates.find((u) => u.id === p.id);
        return next ? { ...p, status: next.status, sort_order: next.sort_order } : p;
      }),
    );

    await Promise.all(updates.map((u) => persistProjectMove(u.id, u.status, u.sort_order)));
    if (project.status !== toSlug) {
      const destCol = columns.find((c) => c.slug === toSlug);
      await logActivity({
        action: "moved project",
        details: `${project.name} → ${destCol?.label ?? toSlug}`,
        projectId: project.id,
        clientId: project.client_id,
        userId: user?.id,
      });
    }
  }

  async function moveColumn(columnId: number, targetId: number, after: boolean) {
    if (columnId === targetId) return;
    const next = [...columns];
    const from = next.findIndex((c) => c.id === columnId);
    const to = next.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    let insertAt = next.findIndex((c) => c.id === targetId);
    if (insertAt < 0) return;
    if (after) insertAt += 1;
    next.splice(insertAt, 0, moved);
    const ordered = next.map((c, i) => ({ ...c, sort_order: i }));
    setColumns(ordered);
    await reorderBoardColumns(ordered.map((c) => c.id));
  }

  async function onAddColumn(e: FormEvent) {
    e.preventDefault();
    const label = newName.trim();
    if (!label) return;
    setBusy(true);
    const col = await createBoardColumn(label, newColor);
    setColumns((prev) => [...prev, col].sort((a, b) => a.sort_order - b.sort_order));
    setNewName("");
    setNewColor("slate");
    setAddOpen(false);
    setBusy(false);
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!renameTarget) return;
    const label = renameValue.trim();
    if (!label) return;
    setBusy(true);
    await renameBoardColumn(renameTarget.id, label);
    await updateBoardColumnColor(renameTarget.id, renameColor);
    setColumns((prev) =>
      prev.map((c) =>
        c.id === renameTarget.id ? { ...c, label, color: renameColor, is_system: 0 } : c,
      ),
    );
    setRenameTarget(null);
    setBusy(false);
  }

  async function onColor(col: BoardColumn, color: string) {
    setColumns((prev) => prev.map((c) => (c.id === col.id ? { ...c, color } : c)));
    await updateBoardColumnColor(col.id, color);
  }

  async function createFromBoard() {
    if (!pForm.name.trim() || !newClientId) return;
    setBusy(true);
    try {
      const [row] = await db
        .insert(schema.projects)
        .values({ ...projectInsertValues(pForm, Number(newClientId)), color: await nextProjectColor() })
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
        clientId: Number(newClientId),
        userId: user?.id,
      });
      await applyProjectFolder({
        projectId: row.id,
        clientId: Number(newClientId),
        projectName: pForm.name.trim(),
        folderMode: folderState.folderMode,
        folderId: folderState.folderId,
        folderName: folderState.folderName,
        folderDrive: folderState.folderDrive,
        folderChoices: folderState.folderChoices,
      });
      setProjectOpen(false);
      await refresh();
      navigate(`/projects/${row.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(col: BoardColumn) {
    if (columns.length <= 1) return;
    const fallback = columns.find((c) => c.id !== col.id);
    if (!fallback) return;
    const ok = window.confirm(
      t("projects.deleteColumnConfirm", { name: col.label, target: fallback.label }),
    );
    if (!ok) return;
    await deleteBoardColumn(col.id);
    await refresh();
  }

  if (!ready) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        eyebrow={t("projects.eyebrow")}
        title={title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {columns.length > 0 && (
              <Button variant="outline" onClick={toggleAll}>
                {allCollapsed ? t("projects.expandAll") : t("projects.collapseAll")}
              </Button>
            )}
            {canEdit && (
              <>
                <Button
                  onClick={() => {
                    setPForm(emptyProjectForm);
                    setNewClientId(selectedClientId ?? "");
                    setProjectOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {t("projects.new")}
                </Button>
                <Button variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" />
                  {t("projects.addColumn")}
                </Button>
              </>
            )}
          </div>
        }
      />

      {columns.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-5" />}
          title={t("projects.empty")}
          description={t("projects.emptyDesc")}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-1.5 sm:max-w-md">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("projects.jumpHint")}
            </label>
            <Select disabled={scoped.length === 0} onValueChange={(id) => navigate(`/projects/${id}`)}>
              <SelectTrigger className="h-10 w-full bg-card">
                <SelectValue placeholder={t("projects.jump")} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {scoped.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(16.5rem,1fr))] items-start gap-3 pb-3">
            {columns.map((col) => {
              const items = byColumn[col.slug] ?? [];
              const isOver = overSlug === col.slug && dragging?.type === "card";
              const isCollapsed = Boolean(collapsed[col.slug]);
              const tone = boardColor(col.color);
              const colOver = overCol?.id === col.id && dragging?.type === "column";
              const draggingCol = dragging?.type === "column" && dragging.columnId === col.id;
              return (
                <section
                  key={col.slug}
                  onDragOver={(e) => {
                    if (!canEdit || !dragging) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragging.type === "card") {
                      setOverSlug(col.slug);
                      return;
                    }
                    if (dragging.columnId === col.id) {
                      setOverCol(null);
                      return;
                    }
                    const box = e.currentTarget.getBoundingClientRect();
                    setOverCol({ id: col.id, after: e.clientX > box.left + box.width / 2 });
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setOverSlug((s) => (s === col.slug ? null : s));
                      setOverBefore(null);
                      setOverCol((s) => (s?.id === col.id ? null : s));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!canEdit || !dragging) return;
                    if (dragging.type === "column") {
                      const after = overCol?.id === col.id ? overCol.after : false;
                      void moveColumn(dragging.columnId, col.id, after);
                    } else {
                      void moveProject(dragging.projectId, col.slug, overBefore ?? undefined);
                    }
                    setDragging(null);
                    setOverSlug(null);
                    setOverBefore(null);
                    setOverCol(null);
                  }}
                  className={cn(
                    "flex min-w-0 flex-col rounded-lg border bg-muted/40 transition-colors",
                    isCollapsed && "min-h-12",
                    isOver && "border-primary/50 bg-primary/6",
                    colOver && !overCol?.after && "border-l-4 border-l-primary",
                    colOver && overCol?.after && "border-r-4 border-r-primary",
                    draggingCol && "opacity-45",
                  )}
                >
                  <header className="flex items-center gap-1.5 border-b px-2 py-2">
                    {canEdit && (
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", `col:${col.id}`);
                          setDragging({ type: "column", columnId: col.id });
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOverCol(null);
                        }}
                        className={cn(
                          "mt-0.5 shrink-0 text-muted-foreground/70",
                          "cursor-grab active:cursor-grabbing",
                        )}
                        aria-hidden
                        title={t("projects.dragColumn")}
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => toggleColumn(col.slug)}
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? t("projects.expand") : t("projects.collapse")}
                      className="shrink-0 text-muted-foreground"
                    >
                      <ChevronDown className={cn("size-3.5 transition-transform", isCollapsed && "-rotate-90")} />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "inline-flex max-w-full items-center truncate rounded-md border px-2 py-0.5 text-[12px] font-semibold tracking-tight",
                          tone.name,
                        )}
                      >
                        {col.label}
                      </span>
                    </div>
                    <span className="tabular-nums text-[11px] font-medium text-muted-foreground">
                      {items.length}
                    </span>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label={col.label}>
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget(col);
                              setRenameValue(col.label);
                              setRenameColor(col.color || "slate");
                            }}
                          >
                            {t("projects.renameColumn")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={columns.length <= 1}
                            onClick={() => void onDelete(col)}
                          >
                            {t("projects.deleteColumn")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </header>

                  {!isCollapsed && (
                    <>
                      <div className="border-b px-2 py-2">
                        <Select
                          disabled={items.length === 0}
                          onValueChange={(id) => navigate(`/projects/${id}`)}
                        >
                          <SelectTrigger size="sm" className="h-8 w-full bg-card">
                            <SelectValue placeholder={t("projects.sectionJump")} />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                        {items.length === 0 ? (
                          <p className="px-2 py-8 text-center text-[12px] text-muted-foreground">
                            {t("projects.colEmpty")}
                          </p>
                        ) : (
                          items.map((p) => {
                            const client = clients.find((c) => c.id === p.client_id);
                            const used = percent(p.spent, p.budget);
                            const isDrag = dragging?.type === "card" && dragging.projectId === p.id;
                            return (
                              <Card
                                key={p.id}
                                draggable={canEdit}
                                onDragStart={(e) => {
                                  if (!canEdit) return;
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", String(p.id));
                                  setDragging({ type: "card", projectId: p.id, fromSlug: col.slug });
                                }}
                                onDragEnd={() => {
                                  setDragging(null);
                                  setOverSlug(null);
                                  setOverBefore(null);
                                  setOverCol(null);
                                }}
                                onDragOver={(e) => {
                                  if (!canEdit || dragging?.type !== "card" || dragging.projectId === p.id) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.dataTransfer.dropEffect = "move";
                                  setOverSlug(col.slug);
                                  setOverBefore(p.id);
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!canEdit || dragging?.type !== "card") return;
                                  void moveProject(dragging.projectId, col.slug, p.id);
                                  setDragging(null);
                                  setOverSlug(null);
                                  setOverBefore(null);
                                  setOverCol(null);
                                }}
                                className={cn(
                                  "gap-0 rounded-md py-0 shadow-none transition-opacity",
                                  isDrag && "opacity-40",
                                  canEdit && "cursor-grab active:cursor-grabbing",
                                )}
                              >
                                <div className="flex gap-1 px-2 py-2.5">
                                  {canEdit && (
                                    <span
                                      className="mt-0.5 text-muted-foreground/60"
                                      aria-hidden
                                      title={t("projects.dragHandle")}
                                    >
                                      <GripVertical className="size-3.5" />
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/projects/${p.id}`)}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <p className="font-display text-[15px] font-semibold tracking-tight text-foreground">
                                      {p.name}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                      {p.project_number}
                                      {!user?.is_admin || !selectedClient
                                        ? ` · ${client?.company_name ?? t("projects.clientFallback")}`
                                        : ""}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      <StatusBadge value={p.phase} />
                                      {p.city && (
                                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                          <MapPin className="size-3" />
                                          {p.city}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-3">
                                      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                                        <span className="tabular-nums">{money(p.spent, locale)}</span>
                                        <span className="tabular-nums">
                                          {t("projects.budgetUsed", { pct: used })}
                                        </span>
                                      </div>
                                      <div className="h-1 overflow-hidden rounded-full bg-muted">
                                        <div
                                          className="h-full rounded-full bg-primary"
                                          style={{ width: `${Math.min(used, 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              </Card>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projects.new")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createFromBoard();
            }}
          >
            <ProjectFormFields
              form={pForm}
              onChange={setPForm}
              clients={clients}
              clientId={newClientId}
              onClientId={setNewClientId}
              folderMode={folderState.folderMode}
              onFolderMode={folderState.setFolderMode}
              folderChoices={folderState.folderChoices}
              folderId={folderState.folderId}
              onFolderId={folderState.setFolderId}
              folderName={folderState.folderName}
              onFolderName={folderState.setFolderName}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectOpen(false)}>
                {t("clients.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !pForm.name.trim() || !newClientId}>
                {busy ? t("clients.creating") : t("clients.createProject")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={onAddColumn}>
            <DialogHeader>
              <DialogTitle>{t("projects.addColumn")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="col-name">{t("projects.columnName")}</Label>
                <Input
                  id="col-name"
                  className="mt-1.5"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("projects.columnPlaceholder")}
                  autoFocus
                />
              </div>
              <ColorPicker value={newColor} onChange={setNewColor} label={t("projects.columnColor")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {t("project.cancel")}
              </Button>
              <Button type="submit" disabled={!newName.trim() || busy}>
                {t("projects.createColumn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={onRename}>
            <DialogHeader>
              <DialogTitle>{t("projects.editColumn")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="col-rename">{t("projects.columnName")}</Label>
                <Input
                  id="col-rename"
                  className="mt-1.5"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                />
              </div>
              {renameTarget && (
                <ColorPicker
                  value={renameColor}
                  onChange={(id) => {
                    setRenameColor(id);
                    void onColor(renameTarget, id);
                  }}
                  label={t("projects.columnColor")}
                />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                {t("project.cancel")}
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || busy}>
                {t("project.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
