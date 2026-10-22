import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  deleteBillingFile,
  saveFileDetails,
  uploadBillingFile,
  type FileDetails,
} from "@/lib/billing-files";
import { GST_RATE, QST_RATE, roundMoney } from "@/lib/invoice";
import { useI18n } from "@/lib/i18n";
import type { BillingFile, BillingRequest, Client, Project } from "@/lib/types";

export type UploadTarget = {
  kind: "invoice" | "quote";
  /** Set when adding a document to an existing quote (an annex / sub-file). */
  parent?: BillingFile | null;
  /** Open client requests this annex answers. */
  requests?: BillingRequest[];
  /** How many versions the quote already has (original included): the next one is numbered number-N. */
  nextVersion?: number;
  /** The file is an add-on to the final quote (not a new version). */
  addon?: boolean;
};

type Phase = "pick" | "analyzing" | "review";

const NONE = "none";

function numStr(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Upload a quote or invoice as a file. The AI reads the amounts; staff check them and publish.
 * Published documents are what the client sees in their own billing section.
 */
export function BillingUploadDialog({
  target,
  clients,
  projects,
  userId,
  onClose,
  onDone,
}: {
  target: UploadTarget | null;
  clients: Client[];
  projects: Project[];
  userId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState(NONE);
  const [requestId, setRequestId] = useState(NONE);
  const [record, setRecord] = useState<BillingFile | null>(null);
  const [aiMessage, setAiMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [gst, setGst] = useState("");
  const [qst, setQst] = useState("");
  const [total, setTotal] = useState("");
  const [status, setStatus] = useState("sent");

  const kind = target?.kind ?? "invoice";
  const parent = target?.parent ?? null;
  const openRequests = (target?.requests ?? []).filter((r) => r.status === "open");

  useEffect(() => {
    if (!target) return;
    setPhase("pick");
    setFile(null);
    setClientId(parent ? String(parent.client_id) : "");
    setProjectId(parent?.project_id ? String(parent.project_id) : NONE);
    setRequestId(openRequests[0] ? String(openRequests[0].id) : NONE);
    setRecord(null);
    setAiMessage(null);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const clientProjects = projects.filter((p) => String(p.client_id) === clientId);

  function pick(next: File | undefined | null) {
    if (!next) return;
    if (!ACCEPTED_TYPES.includes(next.type)) {
      setError(t("billing.upload.badFile"));
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setError(t("billing.upload.tooBig"));
      return;
    }
    setError(null);
    setFile(next);
  }

  async function analyze() {
    if (!file || !clientId) {
      setError(t("billing.upload.needClient"));
      return;
    }
    if (projectId === NONE) {
      // The project decides which budget the quote or invoice belongs to, so it is required.
      setError(t("billing.upload.needProject"));
      return;
    }
    setError(null);
    setPhase("analyzing");
    try {
      const result = await uploadBillingFile({
        file,
        kind,
        clientId: Number(clientId),
        projectId: projectId === NONE ? null : Number(projectId),
        parentId: parent?.id ?? null,
        requestId: requestId === NONE ? null : Number(requestId),
        addon: Boolean(target?.addon),
        userId,
      });
      const r = result.record;
      setRecord(r);
      // A new version of a quote is numbered 1487-1, 1487-2... unless the file itself carries a different number.
      const suggested = parent && target?.nextVersion ? `${parent.number || parent.id}-${target.addon ? "A" : ""}${target.nextVersion}` : "";
      setNumber(parent && (!r.number || r.number === parent.number) ? suggested : r.number ?? "");
      setTitle(r.title ?? "");
      setDescription(r.description ?? "");
      setIssuedOn(r.issued_on ?? new Date().toISOString().slice(0, 10));
      setDueOn(r.due_on ?? "");
      setSubtotal(numStr(r.subtotal));
      setGst(numStr(r.tax_gst));
      setQst(numStr(r.tax_qst));
      setTotal(r.amount ? String(r.amount) : "");
      setStatus("sent");
      if (result.extracted) {
        const conf = result.extracted.confidence ?? "low";
        setAiMessage({
          tone: conf === "high" ? "ok" : "warn",
          text: `${t(`billing.ai.confidence.${conf}` as "billing.ai.confidence.high")}${result.extracted.notes ? ` — ${result.extracted.notes}` : ""}`,
        });
      } else {
        const notConfigured = result.aiError === "ai.notConfigured";
        setAiMessage({
          tone: "warn",
          text: notConfigured ? t("billing.ai.notConfigured") : `${t("billing.ai.failed")}${result.aiError ? ` (${result.aiError})` : ""}`,
        });
      }
      setPhase("review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "billing.upload.failed";
      // "billing.upload.failed:403" -> translated text plus the HTTP code, so the real cause is easy to report.
      const [head, detail] = msg.split("|");
      const [key, code] = head.split(":");
      const translated = t(key as "billing.upload.failed");
      setError(translated === key ? msg : detail ? `${translated} [${detail}]` : code ? `${translated} (HTTP ${code})` : translated);
      setPhase("pick");
    }
  }

  function computeFromSubtotal() {
    const sub = Number(subtotal);
    if (!Number.isFinite(sub) || sub <= 0) return;
    const g = roundMoney(sub * GST_RATE);
    const q = roundMoney(sub * QST_RATE);
    setGst(String(g));
    setQst(String(q));
    setTotal(String(roundMoney(sub + g + q)));
  }

  const toNum = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  async function finish(publish: boolean) {
    if (!record) return;
    const amount = toNum(total);
    if (amount === null || amount <= 0) {
      setError(t("billing.review.needTotal"));
      return;
    }
    if (!number.trim() && !title.trim()) {
      setError(t("billing.review.needName"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const details: FileDetails = {
        number: number.trim(),
        title: title.trim(),
        description: description.trim() || null,
        subtotal: toNum(subtotal),
        tax_gst: toNum(gst),
        tax_qst: toNum(qst),
        amount,
        issued_on: issuedOn || null,
        due_on: dueOn || null,
        status: kind === "invoice" ? status : "sent",
        project_id: projectId === NONE ? null : Number(projectId),
      };
      await saveFileDetails(record, details, publish);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("billing.upload.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    // An analysed-but-unsaved upload must not linger on the server.
    if (record) await deleteBillingFile(record).catch(() => undefined);
    onClose();
  }

  const title0 = parent
    ? target?.addon
      ? t("billing.upload.addonTitle", { number: parent.number || String(parent.id) })
      : t("billing.upload.annexTitle", { number: parent.number || String(parent.id) })
    : kind === "invoice"
      ? t("billing.upload.invoiceTitle")
      : t("billing.upload.quoteTitle");

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && void cancel()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-4" />
            {title0}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("billing.upload.desc")}</DialogDescription>
        </DialogHeader>

        {phase !== "review" ? (
          <div className="grid gap-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors " +
                (dragging ? "border-primary bg-primary/10" : "hover:border-primary/60")
              }
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            >
              <FileUp className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{file ? file.name : t("billing.upload.drop")}</p>
              <p className="text-xs text-muted-foreground">{t("billing.upload.formats")}</p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("billing.client")}</Label>
                <Select value={clientId} onValueChange={(v) => { setClientId(v); setProjectId(NONE); }} disabled={Boolean(parent)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("billing.upload.pickClient")} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("billing.project")}</Label>
                <Select value={projectId} onValueChange={setProjectId} disabled={!clientId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("billing.upload.pickProject")} />
                  </SelectTrigger>
                  <SelectContent>
                    {clientProjects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {parent && openRequests.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{t("billing.upload.answers")}</Label>
                <Select value={requestId} onValueChange={setRequestId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("billing.upload.noRequest")}</SelectItem>
                    {openRequests.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.number} · {r.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : (
          <div className="grid gap-4">
            {aiMessage ? (
              <p
                className={
                  "flex items-start gap-2 border-l-2 px-3 py-2 text-sm " +
                  (aiMessage.tone === "ok" ? "border-emerald-500 bg-emerald-500/10" : "border-primary bg-primary/10")
                }
                role="status"
              >
                {aiMessage.tone === "ok" ? <Sparkles className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
                <span>{aiMessage.text}</span>
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("billing.number")}>
                <Input value={number} onChange={(e) => setNumber(e.target.value)} />
              </Field>
              <Field label={t("billing.docTitle")}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={t("billing.issued")}>
                <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
              </Field>
              {kind === "invoice" ? (
                <Field label={t("billing.due")}>
                  <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
                </Field>
              ) : (
                <div />
              )}
              <Field label={t("invoice.subtotal")}>
                <Input type="number" min="0" step="0.01" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />
              </Field>
              <Field label={t("invoice.gst")}>
                <Input type="number" min="0" step="0.01" value={gst} onChange={(e) => setGst(e.target.value)} />
              </Field>
              <Field label={t("invoice.qst")}>
                <Input type="number" min="0" step="0.01" value={qst} onChange={(e) => setQst(e.target.value)} />
              </Field>
              <Field label={t("invoice.total")}>
                <Input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
              </Field>
            </div>
            <div>
              <Button type="button" size="sm" variant="outline" onClick={computeFromSubtotal}>
                {t("billing.review.compute")}
              </Button>
            </div>
            {kind === "invoice" ? (
              <Field label={t("billing.status")}>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sent">{t("status.sent")}</SelectItem>
                    <SelectItem value="paid">{t("status.paid")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field label={t("billing.description")}>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">{t("billing.review.publishHint")}</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void cancel()} disabled={busy || phase === "analyzing"}>
            {t("clients.cancel")}
          </Button>
          {phase === "review" ? (
            <>
              <Button type="button" variant="outline" onClick={() => void finish(false)} disabled={busy}>
                {t("billing.review.saveDraft")}
              </Button>
              <Button type="button" onClick={() => void finish(true)} disabled={busy}>
                {t("billing.review.publish")}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => void analyze()} disabled={phase === "analyzing" || !file || !clientId || projectId === NONE}>
              {phase === "analyzing" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {phase === "analyzing" ? t("billing.upload.analyzing") : t("billing.upload.analyze")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
