import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, PlusCircle, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { FIELD_TYPES, saveCustomTemplate, type FieldType, type FormDef, type FormField, type FormTemplate } from "@/lib/forms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const uid = () => Math.random().toString(36).slice(2, 9);
const emptyField = (): FormField => ({ id: `f${uid()}`, label: "", type: "text" });
const emptySection = () => ({ id: `s${uid()}`, title: "", repeat: false, fields: [emptyField()] });

function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/**
 * The form creator: a name, then sections, then the questions in each (short text, long text, date, time, number,
 * yes/no or a list of choices). A section can be marked as repeating, like the visitors of the daily log.
 */
export function FormBuilder({
  open,
  template,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** An existing custom form to change, or a built-in one copied as a starting point; null = a blank form. */
  template: FormTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [def, setDef] = useState<FormDef>({ sections: [emptySection()] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (template) {
      setName(template.builtin ? `${template.name} (${t("frm.copy")})` : template.name);
      setDescription(template.description);
      setDef(JSON.parse(JSON.stringify(template.def)) as FormDef);
    } else {
      setName("");
      setDescription("");
      setDef({ sections: [emptySection()] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template]);

  const setSection = (i: number, patch: Partial<FormDef["sections"][number]>) => setDef((d) => ({ sections: d.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const setField = (i: number, j: number, patch: Partial<FormField>) =>
    setDef((d) => ({ sections: d.sections.map((s, k) => (k === i ? { ...s, fields: s.fields.map((fl, m) => (m === j ? { ...fl, ...patch } : fl)) } : s)) }));

  async function save() {
    if (!name.trim()) return setError(t("frm.b.needName"));
    const sections = def.sections.map((s) => ({ ...s, fields: s.fields.filter((fl) => fl.label.trim()).map((fl) => ({ ...fl, label: fl.label.trim() })) })).filter((s) => s.fields.length > 0);
    if (sections.length === 0) return setError(t("frm.b.needQuestion"));
    setBusy(true);
    try {
      await saveCustomTemplate({ id: template && !template.builtin ? template.id : undefined, name, description, def: { sections }, userId: user?.id ?? null });
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template && !template.builtin ? t("frm.b.edit") : t("frm.b.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("frm.b.name")}</Label>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("frm.b.description")}</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {def.sections.map((section, i) => (
            <section key={section.id} className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input className="min-w-48 flex-1" placeholder={t("frm.b.sectionTitle")} value={section.title ?? ""} onChange={(e) => setSection(i, { title: e.target.value })} />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={Boolean(section.repeat)} onCheckedChange={(v) => setSection(i, { repeat: v })} />
                  {t("frm.b.repeat")}
                </label>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("pnav.up")} disabled={i === 0} onClick={() => setDef((d) => ({ sections: move(d.sections, i, -1) }))}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("pnav.down")} disabled={i === def.sections.length - 1} onClick={() => setDef((d) => ({ sections: move(d.sections, i, 1) }))}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("exp.delete")} disabled={def.sections.length === 1} onClick={() => setDef((d) => ({ sections: d.sections.filter((_, k) => k !== i) }))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <ul className="space-y-2">
                {section.fields.map((fl, j) => (
                  <li key={fl.id} className="space-y-2 rounded-xl border bg-card/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input className="min-w-56 flex-1" placeholder={t("frm.b.question")} value={fl.label} onChange={(e) => setField(i, j, { label: e.target.value })} />
                      <Select value={fl.type} onValueChange={(v) => setField(i, j, { type: v as FieldType })}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((ft) => (
                            <SelectItem key={ft} value={ft}>
                              {t(`frm.type.${ft}` as MessageKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox checked={Boolean(fl.required)} onCheckedChange={(v) => setField(i, j, { required: v === true })} />
                        {t("frm.b.required")}
                      </label>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("pnav.up")} disabled={j === 0} onClick={() => setSection(i, { fields: move(section.fields, j, -1) })}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("pnav.down")} disabled={j === section.fields.length - 1} onClick={() => setSection(i, { fields: move(section.fields, j, 1) })}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("exp.delete")} onClick={() => setSection(i, { fields: section.fields.filter((_, m) => m !== j) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {fl.type === "select" ? (
                      <Textarea rows={2} placeholder={t("frm.b.options")} value={(fl.options ?? []).join("\n")} onChange={(e) => setField(i, j, { options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean) })} />
                    ) : null}
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" variant="outline" onClick={() => setSection(i, { fields: [...section.fields, emptyField()] })}>
                <Plus className="size-4" />
                {t("frm.b.addQuestion")}
              </Button>
            </section>
          ))}

          <Button type="button" variant="outline" onClick={() => setDef((d) => ({ sections: [...d.sections, emptySection()] }))}>
            <PlusCircle className="size-4" />
            {t("frm.b.addSection")}
          </Button>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onClose}>
              {t("clients.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("frm.b.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
