import { useCallback, useEffect, useState } from "react";
import { FilePlus2, MessageSquarePlus, PenLine, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuoteSignDialog } from "@/components/QuoteSignDialog";
import { logActivity } from "@/lib/activity";
import { formatDate, moneyExact } from "@/lib/format";
import { emptyLine, lineAmount, totalsFromLines } from "@/lib/invoice";
import { useI18n } from "@/lib/i18n";
import {
  QUOTE_CHANGES_EVENT,
  approvedChangesTotal,
  cancelChange,
  changeLines,
  createClientRequest,
  createStaffAnnex,
  decideChange,
  listChangesForQuote,
  markStaffSeen,
  priceChange,
} from "@/lib/quote-changes";
import { cn } from "@/lib/utils";
import type { BillingDocument, InvoiceLine, QuoteChange } from "@/lib/types";

const STATUS_TONE: Record<string, string> = {
  requested: "bg-amber-500/14 text-amber-800 border-amber-500/25 dark:text-amber-300",
  proposed: "bg-sky-500/12 text-sky-800 border-sky-500/20 dark:text-sky-300",
  approved: "bg-emerald-500/12 text-emerald-800 border-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-rose-500/12 text-rose-800 border-rose-500/20 dark:text-rose-300",
  cancelled: "bg-slate-500/12 text-slate-700 border-slate-500/20 dark:text-slate-300",
};

type Mode = "staff" | "client";

/**
 * Modifications / add-ons (demandes de changement) attached to a quote.
 * Clients ask for a change; FRX prices it as an annex; the client approves or declines it.
 */
export function QuoteChangesSection({
  quote,
  mode,
  canManage,
  userId,
  userName,
  companyName,
}: {
  quote: BillingDocument;
  mode: Mode;
  canManage: boolean;
  userId: number;
  userName: string;
  companyName: string;
}) {
  const { t, locale } = useI18n();
  const [changes, setChanges] = useState<QuoteChange[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [editor, setEditor] = useState<{ change: QuoteChange | null } | null>(null);
  const [signing, setSigning] = useState<QuoteChange | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listChangesForQuote(quote.id);
      setChanges(rows);
      if (mode === "staff") {
        const unseen = rows.filter((c) => c.staff_seen === 0).map((c) => c.id);
        if (unseen.length > 0) await markStaffSeen(unseen);
      }
    } catch (err) {
      console.error("quote changes load failed", err);
    }
  }, [quote.id, mode]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(QUOTE_CHANGES_EVENT, onChange);
    return () => window.removeEventListener(QUOTE_CHANGES_EVENT, onChange);
  }, [load]);

  const closed = quote.status === "rejected" || quote.status === "converted";
  const visible = mode === "client" ? changes.filter((c) => c.status !== "cancelled") : changes;
  const approved = approvedChangesTotal(changes);
  const canRequest = mode === "client" && !closed;
  const canAdd = mode === "staff" && canManage && !closed;

  async function approve(change: QuoteChange, input: { signerName: string; signature: string }) {
    setBusyId(change.id);
    try {
      await decideChange(change, "approved", { userId, signerName: input.signerName, signature: input.signature });
      await logActivity({
        action: "approved quote annex",
        details: `${change.number} signed by ${input.signerName}`,
        clientId: quote.client_id,
        userId,
      });
      setSigning(null);
    } finally {
      setBusyId(null);
    }
  }

  async function decline(change: QuoteChange) {
    setBusyId(change.id);
    try {
      await decideChange(change, "rejected", { userId });
      await logActivity({ action: "declined quote annex", details: change.number, clientId: quote.client_id, userId });
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(change: QuoteChange) {
    setBusyId(change.id);
    try {
      await cancelChange(change);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4 border-t pt-5" aria-label={t("qc.section.title")}>
      <div>
        <h3 className="font-display text-xl leading-none">{t("qc.section.title")}</h3>
      </div>

      {flash ? (
        <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm" role="status">
          {flash}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("qc.none")}</p>
      ) : (
        <div className="space-y-4">
          {visible.map((change) => (
            <AnnexCard
              key={change.id}
              change={change}
              mode={mode}
              canManage={canManage}
              busy={busyId === change.id}
              onPrice={() => setEditor({ change })}
              onCancel={() => void cancel(change)}
              onApprove={() => setSigning(change)}
              onDecline={() => void decline(change)}
            />
          ))}
        </div>
      )}

      {approved > 0 ? (
        <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
          <Row label={t("qc.totals.quote")} value={moneyExact(quote.amount, locale)} />
          <Row label={t("qc.totals.approved")} value={`+ ${moneyExact(approved, locale)}`} />
          <div className="flex items-center justify-between border-t pt-1 font-medium">
            <span>{t("qc.totals.new")}</span>
            <span className="tabular-nums">{moneyExact(quote.amount + approved, locale)}</span>
          </div>
        </div>
      ) : null}

      {canRequest ? (
        <Button type="button" className="w-full sm:w-auto" onClick={() => setRequestOpen(true)}>
          <MessageSquarePlus className="size-4" />
          {t("qc.requestButton")}
        </Button>
      ) : null}
      {canAdd ? (
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setEditor({ change: null })}>
          <FilePlus2 className="size-4" />
          {t("qc.addButton")}
        </Button>
      ) : null}

      <RequestDialog
        open={requestOpen}
        number={quote.number}
        onClose={() => setRequestOpen(false)}
        onSubmit={async (input) => {
          await createClientRequest({ quote, title: input.title, description: input.description, userId });
          await logActivity({
            action: "requested quote change",
            details: `${quote.number}: ${input.title}`,
            clientId: quote.client_id,
            userId,
          });
          setRequestOpen(false);
          setFlash(t("qc.request.sent"));
        }}
      />

      <AnnexEditorDialog
        state={editor}
        quote={quote}
        onClose={() => setEditor(null)}
        onSubmit={async (input) => {
          if (editor?.change) await priceChange(editor.change, { ...input, userId });
          else await createStaffAnnex({ quote, ...input, userId });
          setEditor(null);
          setFlash(t("qc.annex.sentFlash"));
        }}
      />

      <QuoteSignDialog
        quote={signing ? { ...quote, number: signing.number, title: signing.title, amount: signing.amount } : null}
        companyName={companyName}
        defaultName={userName}
        busy={busyId === signing?.id}
        onCancel={() => setSigning(null)}
        onSubmit={(input) => signing && void approve(signing, input)}
      />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function AnnexCard({
  change,
  mode,
  canManage,
  busy,
  onPrice,
  onCancel,
  onApprove,
  onDecline,
}: {
  change: QuoteChange;
  mode: Mode;
  canManage: boolean;
  busy: boolean;
  onPrice: () => void;
  onCancel: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const { t, locale } = useI18n();
  const lines = changeLines(change);
  const priced = lines.length > 0;
  const statusLabel =
    change.status === "proposed" && mode === "staff" ? t("qc.status.proposedStaff") : t(`qc.status.${change.status}` as "qc.status.requested");

  return (
    <article className="overflow-hidden rounded-sm border bg-white text-black shadow-sm">
      <div className="h-1 bg-[#fbaa19]" />
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg uppercase leading-none tracking-[0.14em]">
              {t("qc.annex.title")} · {change.number}
            </p>
            <p className="mt-1 text-sm font-medium">{change.title}</p>
            <p className="text-xs text-[#51514e]">
              {change.origin === "client" ? t("qc.origin.client") : t("qc.origin.staff")} ·{" "}
              {formatDate(change.requested_at ?? change.proposed_at ?? String(change.created_at), locale)}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
              STATUS_TONE[change.status] ?? "",
            )}
          >
            {statusLabel}
          </span>
        </div>

        {change.description ? <p className="whitespace-pre-wrap text-sm text-[#2c2c2c]">{change.description}</p> : null}

        {priced ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-black text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                  <th className="px-3 py-1.5 text-left">{t("invoice.col.description")}</th>
                  <th className="px-3 py-1.5 text-right">{t("invoice.col.qty")}</th>
                  <th className="px-3 py-1.5 text-right">{t("invoice.col.unit")}</th>
                  <th className="px-3 py-1.5 text-right">{t("invoice.col.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className={i % 2 ? "bg-[#f8f8f7]" : ""}>
                    <td className="px-3 py-1.5">{line.description || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {line.quantity} {line.unit}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{moneyExact(line.unit_price, locale)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{moneyExact(lineAmount(line), locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto w-full max-w-xs space-y-1 text-sm text-[#51514e]">
              <div className="flex justify-between">
                <span>{t("invoice.subtotal")}</span>
                <span className="tabular-nums text-black">{moneyExact(change.subtotal ?? 0, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("invoice.gst")}</span>
                <span className="tabular-nums text-black">{moneyExact(change.tax_gst ?? 0, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("invoice.qst")}</span>
                <span className="tabular-nums text-black">{moneyExact(change.tax_qst ?? 0, locale)}</span>
              </div>
              <div className="flex items-center justify-between bg-[#fbaa19] px-3 py-1.5 font-display text-base font-semibold text-black">
                <span>{t("invoice.total")}</span>
                <span className="tabular-nums">{moneyExact(change.amount, locale)}</span>
              </div>
            </div>
          </>
        ) : change.status === "requested" ? (
          <p className="text-xs text-[#51514e]">{mode === "client" ? t("qc.waitingPrice") : t("qc.needsPrice")}</p>
        ) : null}

        {change.status === "approved" && (change.signed_by || change.signature) ? (
          <div className="border-t border-[#d1d3d4] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#51514e]">{t("invoice.signedBy")}</p>
            {change.signature ? <img src={change.signature} alt="" className="mt-1 h-12 w-auto max-w-[220px] object-contain" /> : null}
            <p className="text-sm font-medium">{change.signed_by}</p>
            {change.decided_at ? (
              <p className="text-xs text-[#51514e]">{t("invoice.signedOn", { date: formatDate(change.decided_at, locale) })}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {mode === "client" && change.status === "proposed" ? (
            <>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onDecline}>
                <X className="size-3.5" />
                {t("qc.decline")}
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={onApprove}>
                <PenLine className="size-3.5" />
                {t("qc.approve")}
              </Button>
            </>
          ) : null}
          {mode === "staff" && canManage && change.status === "requested" ? (
            <Button type="button" size="sm" disabled={busy} onClick={onPrice}>
              <FilePlus2 className="size-3.5" />
              {t("qc.price")}
            </Button>
          ) : null}
          {mode === "staff" && canManage && (change.status === "requested" || change.status === "proposed") ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
              {t("qc.cancelAnnex")}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function RequestDialog({
  open,
  number,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Number of the quote the change is requested on. */
  number: string;
  onClose: () => void;
  onSubmit: (input: { title: string; description: string }) => Promise<void>;
}) {
  const { t, tr } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (!title.trim() || !description.trim()) {
      setError(t("qc.request.needFields"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ title, description });
    } catch (err) {
      setError(tr(err, "qc.request.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="size-4" />
            {t("qc.request.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("qc.request.desc", { number })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="qc-title">{t("qc.request.subject")}</Label>
            <Input id="qc-title" value={title} maxLength={140} placeholder={t("qc.request.subjectHint")} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qc-details">{t("qc.request.details")}</Label>
            <Textarea id="qc-details" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {t("qc.request.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnnexEditorDialog({
  state,
  quote,
  onClose,
  onSubmit,
}: {
  state: { change: QuoteChange | null } | null;
  quote: BillingDocument;
  onClose: () => void;
  onSubmit: (input: { title: string; description: string; lines: InvoiceLine[] }) => Promise<void>;
}) {
  const { t, locale, tr } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = state?.change ?? null;

  useEffect(() => {
    if (!state) return;
    setTitle(change?.title ?? "");
    setDescription(change?.origin === "staff" ? change.description ?? "" : "");
    setLines(change && changeLines(change).length > 0 ? changeLines(change) : [emptyLine()]);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, change?.id]);

  const totals = totalsFromLines(lines.filter((l) => l.description.trim() || l.unit_price > 0));

  function patch(i: number, next: Partial<InvoiceLine>) {
    setLines((current) => current.map((line, idx) => (idx === i ? { ...line, ...next } : line)));
  }

  async function submit() {
    if (!title.trim()) {
      setError(t("qc.editor.needTitle"));
      return;
    }
    if (!lines.some((l) => l.description.trim() && l.unit_price > 0)) {
      setError(t("qc.editor.needLine"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ title, description, lines });
    } catch (err) {
      setError(tr(err, "qc.request.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("qc.editor.title", { number: quote.number })}</DialogTitle>
          <DialogDescription className="sr-only">{t("qc.editor.desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {change?.origin === "client" && change.description ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("qc.editor.clientRequest")}</p>
              <p className="mt-1 whitespace-pre-wrap">{change.description}</p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="annex-title">{t("qc.request.subject")}</Label>
            <Input id="annex-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("qc.editor.lines")}</Label>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("invoice.col.description")}</th>
                    <th className="w-20 px-3 py-2 font-medium">{t("invoice.col.qty")}</th>
                    <th className="w-20 px-3 py-2 font-medium">{t("qc.editor.unit")}</th>
                    <th className="w-28 px-3 py-2 font-medium">{t("invoice.col.unit")}</th>
                    <th className="w-28 px-3 py-2 text-right font-medium">{t("invoice.col.amount")}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((line, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <Input value={line.description} onChange={(e) => patch(i, { description: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => patch(i, { quantity: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={line.unit} onChange={(e) => patch(i, { unit: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => patch(i, { unit_price: Number(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{moneyExact(lineAmount(line), locale)}</td>
                      <td className="px-1 py-1.5">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={lines.length === 1}
                          onClick={() => setLines((current) => current.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
              <Plus className="size-3.5" />
              {t("qc.editor.addLine")}
            </Button>
          </div>
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <Row label={t("invoice.subtotal")} value={moneyExact(totals.subtotal, locale)} />
            <Row label={t("invoice.gst")} value={moneyExact(totals.tax_gst, locale)} />
            <Row label={t("invoice.qst")} value={moneyExact(totals.tax_qst, locale)} />
            <div className="flex justify-between border-t pt-1 font-medium">
              <span>{t("invoice.total")}</span>
              <span className="tabular-nums">{moneyExact(totals.amount, locale)}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="annex-note">{t("qc.editor.note")}</Label>
            <Textarea id="annex-note" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {t("qc.editor.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
