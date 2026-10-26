import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, deleteBillingFile, uploadBillingFile } from "@/lib/billing-files";
import { addCostEntry } from "@/lib/project-finance";
import { useI18n } from "@/lib/i18n";
import type { BillingFile, Project } from "@/lib/types";

/**
 * Adds a real cost to a project. Private to FRX staff.
 *  - "invoice": a supplier invoice. The PDF is optional; if given, the AI reads supplier, date and amount for you.
 *  - "quick": a single amount typed in, with no document.
 * Amounts are before taxes.
 */
export function ProjectCostDialog({
  open,
  mode,
  projects,
  defaultProjectId,
  clientId,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "invoice" | "quick";
  projects: Project[];
  defaultProjectId: number | null;
  clientId: number;
  userId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tr } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [record, setRecord] = useState<BillingFile | null>(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProjectId(defaultProjectId ? String(defaultProjectId) : projects.length === 1 ? String(projects[0].id) : "");
    setFile(null);
    setRecord(null);
    setReading(false);
    setNote(null);
    setSupplier("");
    setDescription("");
    setDate(new Date().toISOString().slice(0, 10));
    setAmount("");
    setPaid(false);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(next: File | undefined | null) {
    if (!next) return;
    if (!ACCEPTED_TYPES.includes(next.type)) return setError(t("billing.upload.badFile"));
    if (next.size > MAX_UPLOAD_BYTES) return setError(t("billing.upload.tooBig"));
    setError(null);
    setFile(next);
    setRecord(null);
  }

  async function read() {
    if (!file) return;
    if (!projectId) return setError(t("cost.needProject"));
    setError(null);
    setReading(true);
    try {
      const result = await uploadBillingFile({ file, kind: "supplier", clientId, projectId: Number(projectId), userId });
      setRecord(result.record);
      const x = result.extracted;
      if (x) {
        if (x.client_name) setSupplier(x.client_name);
        if (x.number) setDescription((d) => d || `${t("cost.invoiceNo")} ${x.number}`);
        if (x.issued_on) setDate(x.issued_on);
        const before = x.subtotal ?? (x.total !== undefined ? Math.round((x.total / 1.14975) * 100) / 100 : undefined);
        if (before !== undefined) setAmount(String(before));
        setNote(t("cost.aiRead"));
      } else {
        setNote(result.aiError === "ai.notConfigured" ? t("billing.ai.notConfigured") : `${t("billing.ai.failed")}${result.aiError ? ` (${String(result.aiError).split("|")[1] ?? result.aiError})` : ""}`);
      }
    } catch (err) {
      setError(tr(err, "billing.upload.failed"));
    } finally {
      setReading(false);
    }
  }

  async function save() {
    const value = Number(amount);
    if (!projectId) return setError(t("cost.needProject"));
    if (!Number.isFinite(value) || value <= 0) return setError(t("cost.needAmount"));
    setBusy(true);
    setError(null);
    try {
      await addCostEntry({
        project_id: Number(projectId),
        source: mode,
        supplier: supplier.trim() || null,
        description: description.trim() || null,
        incurred_on: date || null,
        amount: value,
        paid: paid ? 1 : 0,
        file_id: record?.id ?? null,
      });
      onSaved();
    } catch (err) {
      setError(tr(err, "billing.upload.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    // A supplier PDF that was read but never saved must not stay on the server.
    if (record) await deleteBillingFile(record).catch(() => undefined);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && void cancel()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "invoice" ? t("cost.invoiceTitle") : t("cost.quickTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{mode === "invoice" ? t("cost.invoiceDesc") : t("cost.quickDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!defaultProjectId && projects.length > 1 ? (
            <div className="space-y-1.5">
              <Label>{t("billing.project")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("billing.upload.pickProject")} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.project_number ? `${p.project_number} · ` : ""}
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {mode === "invoice" ? (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                  <FileUp className="size-3.5" />
                  {file ? file.name : t("cost.pickPdf")}
                </Button>
                {file ? (
                  <Button type="button" size="sm" onClick={() => void read()} disabled={reading || Boolean(record)}>
                    {reading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {t("billing.upload.analyze")}
                  </Button>
                ) : null}
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("cost.pdfOptional")}</p>
              {note ? <p className="text-xs">{note}</p> : null}
            </div>
          ) : null}

          {mode === "invoice" ? (
            <div className="space-y-1.5">
              <Label htmlFor="cost-supplier">{t("cost.supplier")}</Label>
              <Input id="cost-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="cost-desc">{mode === "invoice" ? t("billing.description") : t("cost.quickLabel")}</Label>
            <Input id="cost-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cost-date">{t("billing.issued")}</Label>
              <Input id="cost-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-amount">{t("cost.amount")}</Label>
              <Input id="cost-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={paid} onCheckedChange={(v) => setPaid(v === true)} />
            {t("cost.paidSupplier")}
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void cancel()} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || reading}>
            {t("settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
