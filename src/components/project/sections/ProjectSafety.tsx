import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { desc, eq } from "drizzle-orm";
import { FolderOpen, HardHat, Loader2, MapPin, Paperclip, Pencil, Plus, ShieldAlert, Users } from "lucide-react";
import { db, schema } from "../../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { formatDate, todayISO } from "@/lib/format";
import { SAFETY_SEVERITIES, SAFETY_STATUSES } from "@/lib/constants";
import { addAttachment, countAttachments } from "@/lib/project-files";
import { callSharePoint, loadProjectFolders, type SpItem } from "@/lib/sharepoint";
import { logActivity } from "@/lib/activity";
import { projectSectionPath } from "@/lib/project-nav";
import { Attachments } from "@/components/project/Attachments";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

type Incident = typeof schema.safety_incidents.$inferSelect;
const TYPES = ["injury", "near_miss", "property", "unsafe", "environment", "other"] as const;
const SEVERITY_STYLE: Record<string, string> = {
  observation: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  near_miss: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  minor: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  serious: "bg-red-500/15 text-red-700 dark:text-red-300",
};
const blank = () => ({
  incident_date: todayISO(),
  incident_type: "near_miss",
  severity: "observation",
  title: "",
  location: "",
  people_involved: "",
  description: "",
  immediate_action: "",
  corrective_action: "",
  status: "open",
});

/**
 * SST (health and safety): a form to report an incident with its photos and files, and a door to the
 * project's security folder in Documentation.
 */
export function ProjectSafety({ project, people }: SectionProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Incident[]>([]);
  const [fileCount, setFileCount] = useState<Record<number, number>>({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Incident | null>(null);
  const [form, setForm] = useState(blank);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [folderNote, setFolderNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, counts] = await Promise.all([
      db.select().from(schema.safety_incidents).where(eq(schema.safety_incidents.project_id, project.id)).orderBy(desc(schema.safety_incidents.incident_date), desc(schema.safety_incidents.id)),
      countAttachments(project.id, "sst"),
    ]);
    setItems(rows);
    setFileCount(counts);
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setEditing(null);
    setForm(blank());
    setPending([]);
    setOpen(true);
  }
  function openEdit(row: Incident) {
    setEditing(row);
    setForm({
      incident_date: row.incident_date,
      incident_type: row.incident_type ?? "other",
      severity: row.severity,
      title: row.title,
      location: row.location ?? "",
      people_involved: row.people_involved ?? "",
      description: row.description ?? "",
      immediate_action: row.immediate_action ?? "",
      corrective_action: row.corrective_action ?? "",
      status: row.status,
    });
    setPending([]);
    setOpen(true);
  }

  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const values = {
        incident_date: form.incident_date,
        incident_type: form.incident_type,
        severity: form.severity,
        title: form.title.trim(),
        location: form.location.trim() || null,
        people_involved: form.people_involved.trim() || null,
        description: form.description.trim() || null,
        immediate_action: form.immediate_action.trim() || null,
        corrective_action: form.corrective_action.trim() || null,
        status: form.status,
      };
      let id = editing?.id;
      if (editing) await db.update(schema.safety_incidents).set(values).where(eq(schema.safety_incidents.id, editing.id));
      else {
        const [row] = await db.insert(schema.safety_incidents).values({ ...values, project_id: project.id, reported_by: user?.id ?? null }).returning();
        id = row.id;
        await logActivity({ action: "logged safety incident", details: values.title, projectId: project.id, userId: user?.id });
      }
      for (const file of pending) if (id) await addAttachment(file, { projectId: project.id, owner: "sst", ownerId: id, userId: user?.id ?? null }).catch(() => undefined);
      setOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /** The security folder is a folder inside the project's documentation root, found by its name. */
  async function openSecurityFolder() {
    setFinding(true);
    setFolderNote(null);
    try {
      const rows = await loadProjectFolders(project.id);
      const root = [...rows].filter((r) => r.sp_item_id).sort((a, b) => a.id - b.id)[0];
      if (!root) {
        setFolderNote(t("pdoc.noFolder"));
        return;
      }
      const data = await callSharePoint<{ items: SpItem[] }>("list", { driveId: root.sp_drive_id, itemId: root.sp_item_id });
      const found = data.items.find((i) => i.isFolder && /sst|s[ée]curit|safety/i.test(i.name));
      if (found) navigate(`${projectSectionPath(project.id, "documents")}?open=${encodeURIComponent(found.id)}`);
      else {
        setFolderNote(t("sst.noFolder"));
        navigate(projectSectionPath(project.id, "documents"));
      }
    } catch {
      navigate(projectSectionPath(project.id, "documents"));
    } finally {
      setFinding(false);
    }
  }

  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex-row items-center gap-4 p-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <FolderOpen className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-tight tracking-wide">{t("sst.folderTitle")}</p>
            {folderNote ? <p className="mt-0.5 text-xs text-muted-foreground">{folderNote}</p> : null}
          </div>
          <Button variant="outline" onClick={() => void openSecurityFolder()} disabled={finding}>
            {finding ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
            {t("sst.openFolder")}
          </Button>
        </Card>
        <Card className="flex-row items-center gap-4 p-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
            <ShieldAlert className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-tight tracking-wide">{t("sst.formTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("sst.count", { n: items.length })}</p>
          </div>
          <Button onClick={openNew}>
            <Plus className="size-4" />
            {t("sst.report")}
          </Button>
        </Card>
      </div>

      {items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">{t("sst.empty")}</Card>
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id}>
              <Card className="gap-3 p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{i.title}</p>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", SEVERITY_STYLE[i.severity])}>{t(`status.${i.severity}` as MessageKey)}</span>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t(`status.${i.status}` as MessageKey)}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatDate(i.incident_date, locale)}</span>
                      {i.incident_type ? <span className="inline-flex items-center gap-1"><HardHat className="size-3.5" />{t(`sst.type.${i.incident_type}` as MessageKey)}</span> : null}
                      {i.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{i.location}</span> : null}
                      {i.people_involved ? <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{i.people_involved}</span> : null}
                      {i.reported_by ? <span>{t("sst.reportedBy", { name: who(i.reported_by) })}</span> : null}
                      {fileCount[i.id] ? <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" />{fileCount[i.id]}</span> : null}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openEdit(i)}>
                    <Pencil className="size-4" />
                    {t("exp.edit")}
                  </Button>
                </div>
                {i.description ? <p className="whitespace-pre-wrap text-sm">{i.description}</p> : null}
                {i.immediate_action || i.corrective_action ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {i.immediate_action ? <Detail label={t("sst.immediate")} text={i.immediate_action} /> : null}
                    {i.corrective_action ? <Detail label={t("sst.corrective")} text={i.corrective_action} /> : null}
                  </div>
                ) : null}
                {fileCount[i.id] ? <Attachments projectId={project.id} owner="sst" ownerId={i.id} onChange={() => void load()} /> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("sst.edit") : t("sst.report")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>{t("sst.what")}</Label>
              <Input correct autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("exp.date")}</Label>
                <Input type="date" value={form.incident_date} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("sst.typeLabel")}</Label>
                <Select value={form.incident_type} onValueChange={(v) => setForm({ ...form, incident_type: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((x) => (
                      <SelectItem key={x} value={x}>{t(`sst.type.${x}` as MessageKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("sst.severity")}</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SAFETY_SEVERITIES.map((x) => (
                      <SelectItem key={x.value} value={x.value}>{t(`status.${x.value}` as MessageKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("project.status")}</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SAFETY_STATUSES.map((x) => (
                      <SelectItem key={x.value} value={x.value}>{t(`status.${x.value}` as MessageKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("sst.location")}</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("sst.people")}</Label>
                <Input value={form.people_involved} onChange={(e) => setForm({ ...form, people_involved: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sst.what.happened")}</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sst.immediate")}</Label>
              <Textarea rows={2} value={form.immediate_action} onChange={(e) => setForm({ ...form, immediate_action: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sst.corrective")}</Label>
              <Textarea rows={2} value={form.corrective_action} onChange={(e) => setForm({ ...form, corrective_action: e.target.value })} />
            </div>
            {editing ? (
              <div className="space-y-1.5">
                <Label>{t("sch.files")}</Label>
                <Attachments projectId={project.id} owner="sst" ownerId={editing.id} onChange={() => void load()} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("sch.files")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                    <Paperclip className="size-4" />
                    {t("att.add")}
                    <input type="file" multiple className="sr-only" onChange={(e) => { setPending((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
                  </label>
                  {pending.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="rounded-full bg-muted px-2.5 py-1 text-xs">{f.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("clients.cancel")}</Button>
            <Button onClick={() => void save()} disabled={busy || !form.title.trim()}>
              {t("settings.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm">{text}</p>
    </div>
  );
}
