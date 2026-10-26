import { useEffect, useMemo, useState } from "react";
import { eq } from "drizzle-orm";
import { FileOutput, Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { db, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { todayISO } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { logActivity } from "@/lib/activity";
import { blankData, blankRow, missingRequired, parseData, type FormData, type FormDef, type FormField } from "@/lib/forms";
import { exportFormsPdf } from "@/lib/forms-pdf";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type FillTarget = {
  key: string;
  name: string;
  def: FormDef;
  /** Set when an existing form of the binder is opened. */
  entry?: { id: number; data: string; entry_date: string; created_by: number | null };
};

/**
 * Fill in a form, or open one from the binder. The top reads like the paper form (project, date, type of form),
 * then every section with its questions; sections that repeat can be added to. Saving puts the form in the binder.
 */
export function FormFill({
  project,
  target,
  filledByName,
  onClose,
  onSaved,
}: {
  project: Project;
  target: FillTarget | null;
  filledByName: (id: number | null) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const color = projectColor(project);
  const [data, setData] = useState<FormData>({});
  const [date, setDate] = useState(todayISO());
  const [readOnly, setReadOnly] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    const today = todayISO();
    if (target.entry) {
      setData(parseData(target.entry.data));
      setDate(target.entry.entry_date);
      setReadOnly(true);
    } else {
      setData(blankData(target.def, today));
      setDate(today);
      setReadOnly(false);
    }
    setProblems([]);
  }, [target]);

  const def = target?.def;
  const questionCount = useMemo(() => (def ? def.sections.reduce((n, s) => n + s.fields.length, 0) : 0), [def]);
  if (!target || !def) return null;

  const setCell = (sectionId: string, row: number, fieldId: string, value: string) =>
    setData((prev) => ({ ...prev, [sectionId]: (prev[sectionId] ?? []).map((r, i) => (i === row ? { ...r, [fieldId]: value } : r)) }));

  async function save() {
    if (!target || !def) return;
    const missing = missingRequired(def, data);
    setProblems(missing);
    if (missing.length) return;
    setBusy(true);
    try {
      const values = { data: JSON.stringify(data), entry_date: date };
      if (target.entry) await db.update(schema.form_entries).set(values).where(eq(schema.form_entries.id, target.entry.id));
      else {
        await db.insert(schema.form_entries).values({
          ...values,
          project_id: project.id,
          template_key: target.key,
          template_name: target.name,
          definition: JSON.stringify(def),
          created_by: user?.id ?? null,
        });
        await logActivity({ action: "filled form", details: target.name, projectId: project.id, userId: user?.id });
      }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    if (!target || !def) return;
    await exportFormsPdf({
      items: [{ templateName: target.name, projectName: project.name, projectNumber: project.project_number, date, def, data, filledBy: target.entry ? filledByName(target.entry.created_by) : user?.name }],
      labels: {
        formTitle: t("frm.pdfTitle"),
        project: t("frm.projectName"),
        date: t("exp.date"),
        type: t("frm.type"),
        filledBy: t("frm.filledBy"),
        exportedOn: t("wbs.exportedOn"),
        page: t("wbs.page"),
        of: t("wbs.of"),
        empty: "—",
      },
      locale,
      fileName: `${target.name}_${project.name}_${date}.pdf`,
    });
  }

  const input = (fl: FormField, sectionId: string, rowIndex: number, value: string) => {
    const set = (v: string) => setCell(sectionId, rowIndex, fl.id, v);
    if (readOnly) return <p className="min-h-6 whitespace-pre-wrap border-b border-dashed pb-1 text-sm font-medium">{value || "—"}</p>;
    switch (fl.type) {
      case "longtext":
        return <Textarea rows={3} value={value} onChange={(e) => set(e.target.value)} />;
      case "date":
        return <Input type="date" value={value} onChange={(e) => set(e.target.value)} />;
      case "time":
        return <Input type="time" value={value} onChange={(e) => set(e.target.value)} />;
      case "number":
        return <Input type="number" min={0} step="0.25" value={value} onChange={(e) => set(e.target.value)} />;
      case "yesno":
        return (
          <div className="grid max-w-xs grid-cols-2 gap-2">
            {[t("frm.yes"), t("frm.no")].map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={value === opt}
                onClick={() => set(value === opt ? "" : opt)}
                className={cn("h-10 rounded-lg border text-sm font-medium transition-all", value === opt ? "text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
                style={value === opt ? { background: `color-mix(in srgb, ${color} 22%, var(--card))`, borderColor: color } : undefined}
              >
                {opt}
              </button>
            ))}
          </div>
        );
      case "select":
        return (
          <Select value={value || undefined} onValueChange={set}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {(fl.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return <Input value={value} onChange={(e) => set(e.target.value)} />;
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="space-y-0">
          <div className="bg-neutral-500 px-6 py-4 text-white dark:bg-neutral-600">
            <DialogTitle className="font-sans text-lg font-medium normal-case tracking-normal">{target.entry ? t("frm.titleOpen") : t("frm.titleNew")}</DialogTitle>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-6 pt-4 text-sm">
            <span className="text-muted-foreground">{t("frm.projectName")}</span>
            <span className="text-right font-medium" style={{ color }}>
              {project.name}
            </span>
            <span className="text-muted-foreground">{t("exp.date")}</span>
            <span className="text-right">
              {readOnly ? <span className="font-medium">{date}</span> : <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-auto h-8 w-40" />}
            </span>
            <span className="text-muted-foreground">{t("frm.type")}</span>
            <span className="text-right font-bold uppercase tracking-wide">{target.name}</span>
            {target.entry ? (
              <>
                <span className="text-muted-foreground">{t("frm.filledBy")}</span>
                <span className="text-right">{filledByName(target.entry.created_by)}</span>
              </>
            ) : null}
          </div>
        </DialogHeader>

        <div className="space-y-6 px-6 pt-2 pb-6">
          {def.sections.map((section) => {
            const rows = data[section.id] ?? [];
            return (
              <section key={section.id} className="space-y-4 rounded-2xl border bg-muted/20 p-5" style={{ borderColor: `color-mix(in srgb, ${color} 25%, var(--border))` }}>
                {section.title ? (
                  <h3 className="border-b pb-1.5 font-display text-xl tracking-wide" style={{ color: "#e4002b", borderColor: "color-mix(in srgb, #e4002b 25%, transparent)" }}>
                    {section.title}
                  </h3>
                ) : null}
                {rows.map((row, rowIndex) => (
                  <div key={rowIndex} className={cn("space-y-4", section.repeat && rows.length > 1 && "rounded-xl border bg-card/60 p-4")}>
                    {section.repeat && rows.length > 1 ? (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">#{rowIndex + 1}</span>
                        {!readOnly ? (
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("exp.delete")} onClick={() => setData((prev) => ({ ...prev, [section.id]: (prev[section.id] ?? []).filter((_, i) => i !== rowIndex) }))}>
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {section.fields.map((fl) => (
                      <div key={fl.id} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-start sm:gap-6">
                        <Label className="pt-2 text-[13px] leading-snug">
                          {fl.label}
                          {fl.required && !readOnly ? <span className="text-destructive"> *</span> : null}
                        </Label>
                        {input(fl, section.id, rowIndex, row[fl.id] ?? "")}
                      </div>
                    ))}
                  </div>
                ))}
                {section.repeat && !readOnly ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setData((prev) => ({ ...prev, [section.id]: [...(prev[section.id] ?? []), blankRow(section, todayISO())] }))}>
                    <Plus className="size-4" />
                    {section.addLabel ?? t("frm.addRow")}
                  </Button>
                ) : null}
              </section>
            );
          })}

          {problems.length ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <p className="font-semibold">{t("frm.required")}</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.slice(0, 8).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <span className="text-xs text-muted-foreground">{t("frm.questions", { n: questionCount })}</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void exportPdf()}>
                <FileOutput className="size-4" />
                {t("wbs.export")}
              </Button>
              {readOnly ? (
                <Button onClick={() => setReadOnly(false)}>
                  <Pencil className="size-4" />
                  {t("exp.edit")}
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={onClose}>
                    {t("clients.cancel")}
                  </Button>
                  <Button onClick={() => void save()} disabled={busy}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {t("frm.save")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
