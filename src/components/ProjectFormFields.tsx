import { useEffect, useState } from "react";
import { ChevronRight, FolderOpen, FolderPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { PROJECT_PHASES, PROJECT_STATUSES, PROJECT_TYPES } from "@/lib/constants";
import { assignProjectFolder, callSharePoint, loadAllFolders, loadProjectFolders, type SpItem } from "@/lib/sharepoint";
import { getSharePointSettings, sharepointReady } from "@/lib/settings";
import type { Client, Project } from "@/lib/types";

export const emptyProjectForm = {
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

export type ProjectFormValues = typeof emptyProjectForm;
export type FolderMode = "later" | "existing" | "create";

export function formFromProject(project: Project): ProjectFormValues {
  return {
    name: project.name,
    project_number: project.project_number,
    description: project.description ?? "",
    status: project.status,
    phase: project.phase,
    project_type: project.project_type || "Commercial",
    address: project.address ?? "",
    city: project.city ?? "",
    start_date: project.start_date ?? "",
    end_date: project.end_date ?? "",
    budget: project.budget ? String(project.budget) : "",
  };
}

export function projectInsertValues(form: ProjectFormValues, clientId: number, extra?: { sort_order?: number; spent?: number }) {
  return {
    client_id: clientId,
    name: form.name.trim(),
    project_number:
      form.project_number.trim() ||
      `FOR-${new Date().getFullYear().toString().slice(2)}${String(Math.floor(Math.random() * 90) + 10)}`,
    description: form.description.trim() || null,
    status: form.status,
    phase: form.phase,
    project_type: form.project_type,
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    budget: Number(form.budget) || 0,
    spent: extra?.spent ?? 0,
    sort_order: extra?.sort_order ?? Date.now() % 100000,
  };
}

export async function applyProjectFolder(opts: {
  projectId: number;
  clientId: number;
  projectName: string;
  folderMode: FolderMode;
  folderId: string;
  folderName: string;
  folderDrive: string;
  folderChoices: SpItem[];
}) {
  const cfg = await getSharePointSettings();
  if (!sharepointReady(cfg) || opts.folderMode === "later") return;
  if (opts.folderMode === "create") {
    if (opts.folderId) {
      const path = opts.folderName.trim() || opts.projectName;
      await assignProjectFolder({
        projectId: opts.projectId,
        clientId: opts.clientId,
        name: path.split("/").pop()?.trim() || opts.projectName,
        spItemId: opts.folderId,
        spDriveId: opts.folderDrive || cfg.drive_id,
        path,
      });
      return;
    }
    const name = opts.folderName.trim() || opts.projectName;
    const created = await callSharePoint<{ driveId: string; folder: { id: string; name: string } }>("mkdir", { name });
    await assignProjectFolder({
      projectId: opts.projectId,
      clientId: opts.clientId,
      name: created.folder.name,
      spItemId: created.folder.id,
      spDriveId: created.driveId,
      path: created.folder.name,
    });
    return;
  }
  if (!opts.folderId) return;
  const picked = opts.folderChoices.find((f) => f.id === opts.folderId);
  const path = opts.folderName.trim() || picked?.name || opts.projectName;
  await assignProjectFolder({
    projectId: opts.projectId,
    clientId: opts.clientId,
    name: path.split("/").pop()?.trim() || opts.projectName,
    spItemId: opts.folderId,
    spDriveId: opts.folderDrive || cfg.drive_id,
    path,
  });
}

export function ProjectFormFields({
  form,
  onChange,
  clients,
  clientId,
  onClientId,
  folderMode,
  onFolderMode,
  folderChoices: _folderChoices,
  folderId,
  onFolderId,
  folderName,
  onFolderName,
  assignedName,
}: {
  form: ProjectFormValues;
  onChange: (next: ProjectFormValues) => void;
  clients?: Client[];
  clientId?: number | "";
  onClientId?: (id: number) => void;
  folderMode: FolderMode;
  onFolderMode: (mode: FolderMode) => void;
  folderChoices: SpItem[];
  folderId: string;
  onFolderId: (id: string) => void;
  folderName: string;
  onFolderName: (name: string) => void;
  assignedName?: string;
}) {
  const { t } = useI18n();
  function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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
  return (
    <div className="grid gap-4">
      {clients && onClientId ? (
        <Field label={t("nav.clients")} required>
          <Select value={clientId ? String(clientId) : ""} onValueChange={(v) => onClientId(Number(v))}>
            <SelectTrigger>
              <SelectValue placeholder={t("nav.selectClient")} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.company_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("clients.projectName")} required>
          <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} required />
        </Field>
        <Field label={t("clients.jobNumber")}>
          <Input
            placeholder={t("clients.jobNumberHint")}
            value={form.project_number}
            onChange={(e) => onChange({ ...form, project_number: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("clients.description")}>
        <Textarea rows={2} value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("clients.status")}>
          <Select value={form.status} onValueChange={(v) => onChange({ ...form, status: v })}>
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
          <Select value={form.phase} onValueChange={(v) => onChange({ ...form, phase: v })}>
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
        <Select value={form.project_type} onValueChange={(v) => onChange({ ...form, project_type: v })}>
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
          <Input value={form.address} onChange={(e) => onChange({ ...form, address: e.target.value })} />
        </Field>
        <Field label={t("clients.city")}>
          <Input value={form.city} onChange={(e) => onChange({ ...form, city: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("clients.start")}>
          <Input type="date" value={form.start_date} onChange={(e) => onChange({ ...form, start_date: e.target.value })} />
        </Field>
        <Field label={t("clients.end")}>
          <Input type="date" value={form.end_date} onChange={(e) => onChange({ ...form, end_date: e.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{t("clients.budgetFromQuotes")}</p>
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">{t("sp.assignFolder")}</p>
        <p className="text-xs text-muted-foreground">{t("sp.assignFolderHint")}</p>
        {assignedName ? <p className="text-xs">{t("sp.currentFolder", { name: assignedName })}</p> : null}
        <Select value={folderMode} onValueChange={(v) => onFolderMode(v as FolderMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="existing">{t("sp.assignExisting")}</SelectItem>
            <SelectItem value="create">{t("sp.assignCreate")}</SelectItem>
            <SelectItem value="later">{t("sp.pickLater")}</SelectItem>
          </SelectContent>
        </Select>
        {folderMode === "existing" || folderMode === "create" ? (
          <FolderBrowser
            folderId={folderId}
            onFolderId={onFolderId}
            folderName={folderName}
            onFolderName={onFolderName}
            createMode={folderMode === "create"}
          />
        ) : null}
      </div>
    </div>
  );
}

function FolderBrowser({
  folderId,
  onFolderId,
  folderName,
  onFolderName,
  createMode,
}: {
  folderId: string;
  onFolderId: (id: string) => void;
  folderName: string;
  onFolderName: (name: string) => void;
  createMode: boolean;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<SpItem[]>([]);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [current, setCurrent] = useState<{ id: string; name: string }>({ id: "", name: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getSharePointSettings();
        if (!sharepointReady(cfg)) return;
        const listed = await callSharePoint<{ items: SpItem[] }>("list", {
          driveId: cfg.drive_id,
          itemId: current.id || undefined,
        });
        setItems((listed.items ?? []).filter((item) => item.isFolder));
      } catch {
        setItems([]);
      }
    })();
  }, [current.id]);

  async function createHere() {
    const name = folderName.trim().split("/").pop() || folderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await callSharePoint<{ folder: { id: string; name: string } }>("mkdir", {
        name,
        parentId: current.id || undefined,
      });
      const next = { id: created.folder.id, name: created.folder.name };
      const path = [...trail, next].map((c) => c.name).join(" / ");
      onFolderId(created.folder.id);
      onFolderName(path);
      setTrail((prev) => [...prev, next]);
      setCurrent(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          className="hover:text-primary"
          onClick={() => {
            setTrail([]);
            setCurrent({ id: "", name: "" });
          }}
        >
          {t("sp.crumbRoot")}
        </button>
        {trail.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="size-3" />
            <button
              type="button"
              className="hover:text-primary"
              onClick={() => {
                const next = trail.slice(0, index + 1);
                setTrail(next);
                setCurrent(next[next.length - 1] ?? { id: "", name: "" });
              }}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>
      <ul className="max-h-40 space-y-1 overflow-auto">
        {items.map((folder) => (
          <li key={folder.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                const next = { id: folder.id, name: folder.name };
                const path = [...trail, next].map((c) => c.name).join(" / ");
                setTrail((prev) => [...prev, next]);
                setCurrent(next);
                onFolderId(folder.id);
                onFolderName(path);
              }}
            >
              <FolderOpen className="size-3.5 opacity-70" />
              {folder.name}
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="px-2 py-2 text-xs text-muted-foreground">{t("sp.emptyFolder")}</li> : null}
      </ul>
      {createMode ? (
        <div className="flex gap-2">
          <Input
            value={folderName.includes("/") ? folderName.split("/").pop() ?? "" : folderName}
            onChange={(e) => onFolderName(e.target.value)}
            placeholder={t("sp.folderName")}
          />
          <Button type="button" size="sm" disabled={busy || !folderName.trim()} onClick={() => void createHere()}>
            <FolderPlus className="size-4" />
            {t("sp.createHere")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!current.id && !folderId}
          onClick={() => {
            if (current.id) {
              onFolderId(current.id);
              onFolderName(trail.map((c) => c.name).join(" / ") || current.name);
            }
          }}
        >
          {t("sp.thisFolder")}
        </Button>
      )}
    </div>
  );
}

export function useSharePointFolders(open: boolean, projectId?: number) {
  const [folderChoices, setFolderChoices] = useState<SpItem[]>([]);
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderDrive, setFolderDrive] = useState("");
  const [folderMode, setFolderMode] = useState<FolderMode>("existing");
  const [assignedName, setAssignedName] = useState("");

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const cfg = await getSharePointSettings();
        if (!sharepointReady(cfg)) return;
        const listed = await callSharePoint<{ items: SpItem[]; driveId?: string }>("list", { driveId: cfg.drive_id });
        const folders = (listed.items ?? []).filter((item) => item.isFolder);
        setFolderChoices(folders);
        setFolderDrive(listed.driveId || cfg.drive_id);
        if (projectId) {
          const linked = await loadProjectFolders(projectId);
          if (linked[0]) {
            setAssignedName(linked[0].name);
            setFolderId(linked[0].sp_item_id);
            setFolderMode("existing");
          }
        } else {
          const linked = await loadAllFolders();
          const unused = folders.filter((item) => !linked.some((f) => f.sp_item_id === item.id));
          if (unused[0]) setFolderId(unused[0].id);
          else if (folders[0]) setFolderId(folders[0].id);
        }
      } catch {
        setFolderChoices([]);
      }
    })();
  }, [open, projectId]);

  return {
    folderChoices,
    folderId,
    setFolderId,
    folderName,
    setFolderName,
    folderDrive,
    folderMode,
    setFolderMode,
    assignedName,
  };
}
