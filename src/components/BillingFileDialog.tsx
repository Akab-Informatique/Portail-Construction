import { useEffect, useState } from "react";
import { ExternalLink, FileUp, MessageSquarePlus, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuoteSignDialog } from "@/components/QuoteSignDialog";
import { RequestDialog } from "@/components/QuoteChanges";
import { logActivity } from "@/lib/activity";
import {
  annexesOf,
  createBillingRequest,
  decideFile,
  displayStatus,
  fileViewUrl,
  quoteEffectiveTotal,
  releaseViewUrl,
} from "@/lib/billing-files";
import { formatDate, moneyExact } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BillingFile, BillingRequest } from "@/lib/types";

const TONE: Record<string, string> = {
  sent: "bg-sky-500/12 text-sky-800 border-sky-500/20 dark:text-sky-300",
  paid: "bg-emerald-500/12 text-emerald-800 border-emerald-500/20 dark:text-emerald-300",
  overdue: "bg-rose-500/12 text-rose-800 border-rose-500/20 dark:text-rose-300",
  accepted: "bg-emerald-500/12 text-emerald-800 border-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-rose-500/12 text-rose-800 border-rose-500/20 dark:text-rose-300",
};

export function StatusPill({ file, mode }: { file: BillingFile; mode: "client" | "staff" }) {
  const { t } = useI18n();
  const status = displayStatus(file);
  // An annex still marked "sent" is waiting for the client's decision.
  const label =
    file.parent_id && status === "sent"
      ? mode === "client"
        ? t("billing.annex.waitingYou")
        : t("billing.annex.waiting")
      : t(`status.${status}` as "status.sent");
  return (
    <span className={cn("inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider", TONE[status] ?? "")}>
      {label}
    </span>
  );
}

/**
 * Shows an uploaded invoice/quote. For a quote it also lists the client's change requests and the annexes
 * (sub-files) added in answer; accepted annexes are added to the quote's total.
 */
export function BillingFileDialog({
  file,
  allFiles,
  requests,
  mode,
  canDecide,
  canManage,
  userId,
  userName,
  companyName,
  onClose,
  onChanged,
  onAddDocument,
}: {
  file: BillingFile | null;
  allFiles: BillingFile[];
  requests: BillingRequest[];
  mode: "client" | "staff";
  /** The signed-in client may accept/decline. */
  canDecide: boolean;
  /** Staff may add documents (annexes). */
  canManage: boolean;
  userId: number;
  userName: string;
  companyName: string;
  onClose: () => void;
  onChanged: () => void;
  onAddDocument?: (quote: BillingFile) => void;
}) {
  const { t, locale } = useI18n();
  const [viewing, setViewing] = useState<BillingFile | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [signing, setSigning] = useState<BillingFile | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const current = viewing ?? file;
  // Keep what is shown in step with fresh data (status changes after a decision).
  const live = current ? allFiles.find((f) => f.id === current.id) ?? current : null;

  useEffect(() => {
    setViewing(null);
    setFlash(null);
  }, [file?.id]);

  useEffect(() => {
    if (!current) return;
    let active = true;
    let made: string | null = null;
    setUrl(null);
    setLoadError(false);
    fileViewUrl(current)
      .then((u) => {
        made = u;
        if (active) setUrl(u);
        else releaseViewUrl(u);
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
      releaseViewUrl(made);
    };
  }, [current?.id]);

  if (!file || !live) return null;
  const isQuote = file.kind === "quote";
  const annexes = annexesOf(file, allFiles).filter((a) => mode === "staff" || a.published === 1);
  const fileRequests = requests.filter((r) => r.file_id === file.id).sort((a, b) => a.id - b.id);
  const answeredRequestIds = new Set(annexes.map((a) => a.request_id));
  const effective = quoteEffectiveTotal(file, allFiles);
  const acceptedExtra = effective - file.amount;
  const hasOpenRequest = fileRequests.some((r) => r.status === "open");
  const closed = file.status === "rejected";
  const isImage = (live.file_type ?? "").startsWith("image/");

  async function decide(target: BillingFile, decision: "accepted" | "rejected", input: { signerName?: string; signature?: string } = {}) {
    setBusy(true);
    try {
      await decideFile(target, decision, input);
      await logActivity({
        action: `${decision === "accepted" ? "accepted" : "declined"} ${target.parent_id ? "quote annex" : "quote"}`,
        details: `${target.number || target.id}${input.signerName ? ` signed by ${input.signerName}` : ""}`,
        clientId: target.client_id,
        userId,
      });
      setSigning(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-3">
              <span>
                {live.parent_id ? t("qc.annex.title") : live.kind === "invoice" ? t("billing.kind.invoice") : t("billing.kind.quote")}{" "}
                {live.number || `#${live.id}`}
              </span>
              <StatusPill file={live} mode={mode} />
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {viewing ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(null)}>
                ← {t("billing.annex.back")}
              </Button>
            ) : null}

            {flash ? (
              <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm" role="status">
                {flash}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {live.title}
                {live.issued_on ? ` · ${formatDate(live.issued_on, locale)}` : ""}
                {live.kind === "invoice" && live.due_on ? ` · ${t("billing.due")} ${formatDate(live.due_on, locale)}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {canDecide && live.kind === "quote" && live.status === "sent" ? (
                  <>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void decide(live, "rejected")}>
                      <X className="size-3.5" />
                      {live.parent_id ? t("qc.decline") : t("billing.reject")}
                    </Button>
                    <Button type="button" size="sm" disabled={busy} onClick={() => setSigning(live)}>
                      <PenLine className="size-3.5" />
                      {live.parent_id ? t("qc.approve") : t("billing.approve")}
                    </Button>
                  </>
                ) : null}
                {url ? (
                  <Button asChild type="button" variant="outline" size="sm">
                    <a href={url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                      {t("billing.file.open")}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-md border bg-muted/30">
              {loadError ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("billing.view.missing")}</p>
              ) : !url ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("billing.file.loading")}</p>
              ) : isImage ? (
                <img src={url} alt={live.file_name ?? ""} className="mx-auto max-h-[70vh] w-auto" />
              ) : (
                <iframe title={live.file_name ?? "document"} src={url} className="h-[68vh] w-full bg-white" />
              )}
            </div>

            {isQuote && !viewing ? (
              <section className="space-y-4 border-t pt-5" aria-label={t("qc.section.title")}>
                <div>
                  <h3 className="font-display text-xl leading-none">{t("qc.section.title")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t("billing.mods.subtitle")}</p>
                </div>

                {fileRequests.length === 0 && annexes.length === 0 ? (
                  <p className="rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("qc.none")}</p>
                ) : null}

                {fileRequests.map((request) => (
                  <div key={request.id} className="rounded-md border px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {request.number} · {request.title}
                      </p>
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider",
                          request.status === "open"
                            ? "border-amber-500/25 bg-amber-500/14 text-amber-800 dark:text-amber-300"
                            : "border-emerald-500/20 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
                        )}
                      >
                        {request.status === "open" ? t("qc.status.requested") : t("billing.request.answered")}
                      </span>
                    </div>
                    {request.description ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{request.description}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(request.requested_at, locale)}</p>
                    {request.status === "open" && mode === "client" ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t("qc.waitingPrice")}</p>
                    ) : null}
                  </div>
                ))}

                {annexes.map((annex) => (
                  <div key={annex.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">
                        {t("qc.annex.title")} · {annex.number || `#${annex.id}`}
                      </p>
                      <p className="text-muted-foreground">{annex.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusPill file={annex} mode={mode} />
                        <span className="tabular-nums">{moneyExact(annex.amount, locale)}</span>
                        {annex.published !== 1 ? <span>· {t("billing.draft")}</span> : null}
                        {annex.request_id && answeredRequestIds.has(annex.request_id) ? (
                          <span>· {fileRequests.find((r) => r.id === annex.request_id)?.number}</span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setViewing(annex)}>
                        {t("billing.file.view")}
                      </Button>
                      {canDecide && annex.status === "sent" ? (
                        <>
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide(annex, "rejected")}>
                            <X className="size-3.5" />
                            {t("qc.decline")}
                          </Button>
                          <Button type="button" size="sm" disabled={busy} onClick={() => setSigning(annex)}>
                            <PenLine className="size-3.5" />
                            {t("qc.approve")}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}

                {annexes.some((a) => a.status === "accepted") ? (
                  <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
                    <TotalRow label={t("qc.totals.quote")} value={moneyExact(file.amount, locale)} />
                    <TotalRow label={t("qc.totals.approved")} value={`+ ${moneyExact(acceptedExtra, locale)}`} />
                    <div className="flex items-center justify-between border-t pt-1 font-medium">
                      <span>{t("qc.totals.new")}</span>
                      <span className="tabular-nums">{moneyExact(effective, locale)}</span>
                    </div>
                  </div>
                ) : null}

                {mode === "client" && !closed ? (
                  <Button type="button" className="w-full sm:w-auto" onClick={() => setRequestOpen(true)}>
                    <MessageSquarePlus className="size-4" />
                    {t("qc.requestButton")}
                  </Button>
                ) : null}
                {mode === "staff" && canManage && !closed && onAddDocument ? (
                  <Button type="button" variant={hasOpenRequest ? "default" : "outline"} className="w-full sm:w-auto" onClick={() => onAddDocument(file)}>
                    <FileUp className="size-4" />
                    {t("billing.addDocument")}
                  </Button>
                ) : null}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <RequestDialog
        open={requestOpen}
        number={file.number || String(file.id)}
        onClose={() => setRequestOpen(false)}
        onSubmit={async (input) => {
          await createBillingRequest({ file, title: input.title, description: input.description, userId });
          await logActivity({
            action: "requested quote change",
            details: `${file.number || file.id}: ${input.title}`,
            clientId: file.client_id,
            userId,
          });
          setRequestOpen(false);
          setFlash(t("qc.request.sent"));
          onChanged();
        }}
      />

      <QuoteSignDialog
        quote={signing ? { id: signing.id, number: signing.number || String(signing.id), title: signing.title, amount: signing.amount } : null}
        companyName={companyName}
        defaultName={userName}
        busy={busy}
        onCancel={() => setSigning(null)}
        onSubmit={(input) => signing && void decide(signing, "accepted", input)}
      />
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
