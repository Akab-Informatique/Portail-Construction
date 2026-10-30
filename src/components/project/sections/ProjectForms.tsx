import { useCallback, useEffect, useMemo, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { BookOpenCheck, Copy, FilePlus2, FileOutput, ClipboardList, Paperclip, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { db, schema } from "../../../db";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { builtinForms, deleteCustomTemplate, loadCustomTemplates, parseData, parseDef, type FormTemplate } from "@/lib/forms";
import { exportFormsPdf } from "@/lib/forms-pdf";
import { attachmentsForPdf, countAttachments, removeAttachmentsOf } from "@/lib/project-files";
import { FormBuilder } from "@/components/project/FormBuilder";
import { FormFill, type FillTarget } from "@/components/project/FormFill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";

type Entry = typeof schema.form_entries.$inferSelect;

/**
 * Forms: the forms to fill in for this project (the company's three to start with, plus the ones made in the creator),
 * and the binder where every filled form is kept, grouped by type, ready to export to PDF.
 */
export function ProjectForms({ project, people }: SectionProps) {
  const { t, locale } = useI18n();
  const color = projectColor(project);
  const [view, setView] = useState<"forms" | "binder">("forms");
  const [custom, setCustom] = useState<FormTemplate[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [fill, setFill] = useState<FillTarget | null>(null);
  const [builder, setBuilder] = useState<{ open: boolean; template: FormTemplate | null }>({ open: false, template: null });
  const [binderKey, setBinderKey] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [fileCount, setFileCount] = useState<Record<number, number>>({});

  const load = useCallback(async () => {
    const [templates, rows, counts] = await Promise.all([
      loadCustomTemplates(),
      db.select().from(schema.form_entries).where(eq(schema.form_entries.project_id, project.id)).orderBy(desc(schema.form_entries.entry_date), desc(schema.form_entries.id)),
      countAttachments(project.id, "form"),
    ]);
    setCustom(templates);
    setEntries(rows);
    setFileCount(counts);
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const templates = useMemo(() => [...builtinForms(locale), ...custom], [locale, custom]);
  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "—";
  const countOf = (key: string) => entries.filter((e) => e.template_key === key).length;
  const questions = (tpl: FormTemplate) => tpl.def.sections.reduce((n, s) => n + s.fields.length, 0);

  // binder dividers: one per kind of form that has been filled in
  const dividers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) if (!seen.has(e.template_key)) seen.set(e.template_key, e.template_name);
    return [...seen].map(([key, name]) => ({ key, name, n: entries.filter((e) => e.template_key === key).length }));
  }, [entries]);
  const shown = entries
    .filter((e) => binderKey === "all" || e.template_key === binderKey)
    .filter((e) => !query.trim() || `${e.template_name} ${e.entry_date} ${who(e.created_by)}`.toLowerCase().includes(query.trim().toLowerCase()));

  const pdfLabels = {
    formTitle: t("frm.pdfTitle"),
    project: t("frm.projectName"),
    date: t("exp.date"),
    type: t("frm.type"),
    filledBy: t("frm.filledBy"),
    exportedOn: t("wbs.exportedOn"),
    page: t("wbs.page"),
    of: t("wbs.of"),
    empty: "—",
    attachments: t("frm.attachments"),
  };

  async function exportEntries(list: Entry[]) {
    if (list.length === 0) return;
    const files = await Promise.all(list.map((e) => attachmentsForPdf(project.id, "form", e.id)));
    await exportFormsPdf({
      items: list.map((e, i) => ({
        templateName: e.template_name,
        projectName: project.name,
        projectNumber: project.project_number,
        date: e.entry_date,
        def: parseDef(e.definition),
        data: parseData(e.data),
        filledBy: who(e.created_by),
        files: files[i],
      })),
      labels: pdfLabels,
      locale,
      fileName: list.length === 1 ? `${list[0].template_name}_${project.name}_${list[0].entry_date}.pdf` : `${t("frm.binder")}_${project.name}_${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

  const tabs = [
    { id: "forms" as const, label: t("frm.tabForms"), icon: ClipboardList, n: templates.length },
    { id: "binder" as const, label: t("frm.tabBinder"), icon: BookOpenCheck, n: entries.length },
  ];

  return (
    <div className="space-y-5">
      {/* top: the form creator and the two views */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1 max-w-full overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={cn("flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all", view === tab.id ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              style={view === tab.id ? { background: `color-mix(in srgb, ${color} 18%, var(--card))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)` } : undefined}
            >
              <tab.icon className="size-4" style={view === tab.id ? { color } : undefined} />
              {tab.label}
              <span className="rounded-full bg-black/10 px-1.5 text-[10px] font-bold tabular-nums dark:bg-white/10">{tab.n}</span>
            </button>
          ))}
        </div>
        <Button onClick={() => setBuilder({ open: true, template: null })}>
          <FilePlus2 className="size-4" />
          {t("frm.create")}
        </Button>
      </div>

      {view === "forms" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((tpl) => (
            <Card key={tpl.key} className="gap-3 p-5" style={{ boxShadow: `var(--glass-shadow), inset 0 3px 0 ${color}` }}>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
                  <ClipboardList className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg leading-tight tracking-wide">{tpl.name}</p>
                  {tpl.description ? <p className="mt-1 text-xs text-muted-foreground">{tpl.description}</p> : null}
                </div>
              </div>
              <p className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span>{t("frm.questions", { n: questions(tpl) })}</span>
                <span>·</span>
                <span>{t("frm.filledCount", { n: countOf(tpl.key) })}</span>
                {tpl.builtin ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{t("frm.standard")}</span> : null}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => setFill({ key: tpl.key, name: tpl.name, def: tpl.def })}>
                  <Plus className="size-4" />
                  {t("frm.fill")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBuilder({ open: true, template: tpl })}>
                  {tpl.builtin ? <Copy className="size-4" /> : <Pencil className="size-4" />}
                  {tpl.builtin ? t("frm.duplicate") : t("exp.edit")}
                </Button>
                {!tpl.builtin ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("exp.delete")}
                    onClick={async () => {
                      if (!window.confirm(t("frm.deleteTemplate"))) return;
                      if (tpl.id) await deleteCustomTemplate(tpl.id);
                      await load();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* binder dividers */}
          <nav aria-label={t("frm.binder")} className="space-y-1.5">
            {[{ key: "all", name: t("sch.filter.all"), n: entries.length }, ...dividers].map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setBinderKey(d.key)}
                className={cn("flex w-full items-center gap-2 rounded-l-xl border border-r-0 px-3 py-2.5 text-left text-sm transition-all", binderKey === d.key ? "translate-x-2 font-semibold shadow-md" : "text-muted-foreground hover:translate-x-1")}
                style={{ background: binderKey === d.key ? `color-mix(in srgb, ${color} 22%, var(--card))` : `color-mix(in srgb, ${color} 7%, var(--card))`, borderColor: `color-mix(in srgb, ${color} 35%, var(--border))`, boxShadow: binderKey === d.key ? `inset 4px 0 0 ${color}` : undefined }}
              >
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="rounded-full bg-black/10 px-1.5 text-[10px] font-bold tabular-nums dark:bg-white/10">{d.n}</span>
              </button>
            ))}
          </nav>

          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
              <div className="relative w-56">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input className="h-9 pl-9" value={query} placeholder={t("qrt.search")} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPicked(picked.length === shown.length ? [] : shown.map((e) => e.id))} disabled={shown.length === 0}>
                {picked.length === shown.length && shown.length > 0 ? t("pdoc.clear") : t("pdoc.selectAll")}
              </Button>
              <Button size="sm" variant="outline" disabled={picked.length === 0} onClick={() => void exportEntries(entries.filter((e) => picked.includes(e.id)))}>
                <FileOutput className="size-4" />
                {t("frm.exportSelection", { n: picked.length })}
              </Button>
              <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={() => void exportEntries(shown)}>
                <FileOutput className="size-4" />
                {t("frm.exportAll")}
              </Button>
            </div>
            {shown.length === 0 ? (
              <p className="px-6 py-14 text-center text-sm text-muted-foreground">{t("frm.binderEmpty")}</p>
            ) : (
              <ul className="divide-y">
                {shown.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/5">
                    <Checkbox checked={picked.includes(e.id)} onCheckedChange={(v) => setPicked((prev) => (v === true ? [...prev, e.id] : prev.filter((x) => x !== e.id)))} aria-label={e.template_name} />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setFill({ key: e.template_key, name: e.template_name, def: parseDef(e.definition), entry: { id: e.id, data: e.data, entry_date: e.entry_date, created_by: e.created_by } })}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                        <ClipboardList className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.template_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDate(e.entry_date, locale)} · {who(e.created_by)}
                          {fileCount[e.id] ? (
                            <span className="ml-2 inline-flex items-center gap-1" title={t("frm.attachCount", { n: fileCount[e.id] })}>
                              <Paperclip className="size-3" />
                              {fileCount[e.id]}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <Button size="icon-sm" variant="ghost" aria-label={t("wbs.export")} title={t("wbs.export")} onClick={() => void exportEntries([e])}>
                      <FileOutput className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("exp.delete")}
                      onClick={async () => {
                        if (!window.confirm(t("frm.deleteEntry"))) return;
                        await removeAttachmentsOf(project.id, "form", e.id);
                        await db.delete(schema.form_entries).where(eq(schema.form_entries.id, e.id));
                        setPicked((prev) => prev.filter((x) => x !== e.id));
                        await load();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <FormFill project={project} target={fill} filledByName={who} onClose={() => setFill(null)} onSaved={() => void load().then(() => setView((v) => (fill?.entry ? v : "binder")))} />
      <FormBuilder open={builder.open} template={builder.template} onClose={() => setBuilder({ open: false, template: null })} onSaved={() => void load()} />
    </div>
  );
}
