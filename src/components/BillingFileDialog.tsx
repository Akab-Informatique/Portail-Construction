import { useEffect, useState } from "react";
import { ExternalLink, FileUp, MessageSquarePlus, PenLine, Stamp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuoteSignDialog } from "@/components/QuoteSignDialog";
import { RequestDialog } from "@/components/QuoteChanges";
import { logActivity } from "@/lib/activity";
import {
  addonsOf,
  chainOf,
  createBillingRequest,
  currentRevision,
  decideFile,
  fileViewUrl,
  finalVersion,
  isPendingDecision,
  quoteEffectiveTotal,
  releaseViewUrl,
  revisionStatus,
  rootOf,
  setFinalVersion,
  versionsOf,
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
  final: "bg-emerald-600 text-white border-emerald-600",
  rejected: "bg-rose-500/12 text-rose-800 border-rose-500/20 dark:text-rose-300",
  void: "bg-muted text-muted-foreground border-border line-through",
};

/** Status pill. Pass `status` (from revisionStatus) so superseded versions show as void and the final one as final. */
export function StatusPill({ file, mode, status }: { file: BillingFile; mode: "client" | "staff"; status?: string }) {
  const { t } = useI18n();
  const value = status ?? file.status;
  // A quote version or add-on that is still waiting is waiting for the client's decision.
  const label =
    file.kind === "quote" && value === "sent"
      ? mode === "client"
        ? t("billing.annex.waitingYou")
        : t("billing.annex.waiting")
      : t(`status.${value}` as "status.sent");
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider", TONE[value] ?? "")}>
      {label}
    </span>
  );
}

/**
 * Shows an uploaded invoice/quote. For a quote it lists every version (1487, 1487-1…): the client accepts a version and
 * it replaces the older ones. Once a version is marked final, new PDFs are add-ons whose accepted amounts are added.
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
  /** Staff may upload new versions / add-ons and mark the final version. */
  canManage: boolean;
  userId: number;
  userName: string;
  companyName: string;
  onClose: () => void;
  onChanged: () => void;
  onAddDocument?: (quote: BillingFile, addon: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [signing, setSigning] = useState<BillingFile | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const root = file ? rootOf(file, allFiles) : null;
  const visible = (f: BillingFile) => mode === "staff" || f.published === 1;
  const versions = root ? versionsOf(root, allFiles).filter(visible) : [];
  const addons = root ? addonsOf(root, allFiles).filter(visible) : [];
  const everything = root ? chainOf(root, allFiles).filter(visible) : [];
  const current = root ? currentRevision(root, allFiles) : null;
  const finalOne = root ? finalVersion(root, allFiles) : undefined;
  // Opening a specific document shows that one; otherwise the version in force.
  const shown = everything.find((f) => f.id === viewingId) ?? (file && everything.find((f) => f.id === file.id)) ?? current;

  useEffect(() => {
    setViewingId(null);
    setFlash(null);
  }, [file?.id]);

  useEffect(() => {
    if (!shown) return;
    let active = true;
    let made: string | null = null;
    setUrl(null);
    setLoadError(false);
    fileViewUrl(shown)
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
  }, [shown?.id]);

  if (!file || !root || !shown || !current) return null;
  const isQuote = root.kind === "quote";
  const shownStatus = revisionStatus(shown, allFiles);
  const rootRequests = requests.filter((r) => everything.some((f) => f.id === r.file_id)).sort((a, b) => a.id - b.id);
  const closed = current.status === "rejected" && versions.length === 1 && !finalOne;
  const isImage = (shown.file_type ?? "").startsWith("image/");
  const hasOpenRequest = rootRequests.some((r) => r.status === "open");
  const pendingShown = canDecide && isPendingDecision(shown, allFiles);
  const acceptedAddons = addons.filter((a) => a.published === 1 && a.status === "accepted");
  const total = quoteEffectiveTotal(root, allFiles);

  async function decide(target: BillingFile, decision: "accepted" | "rejected", input: { signerName?: string; signature?: string } = {}) {
    setBusy(true);
    try {
      await decideFile(target, decision, input);
      await logActivity({
        action: `${decision === "accepted" ? "accepted" : "declined"} ${target.is_addon ? "quote add-on" : "quote"}`,
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

  async function toggleFinal(target: BillingFile, makeFinal: boolean) {
    const key = makeFinal ? "billing.final.confirm" : "billing.final.unmarkConfirm";
    if (!window.confirm(t(key, { number: target.number || String(target.id) }))) return;
    setBusy(true);
    try {
      await setFinalVersion(target, allFiles, makeFinal);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function row(doc: BillingFile, kind: "version" | "addon") {
    const status = revisionStatus(doc, allFiles);
    const isCurrent = kind === "version" && doc.id === current!.id && versions.length > 1;
    const pending = canDecide && isPendingDecision(doc, allFiles);
    const canMarkFinal = mode === "staff" && canManage && kind === "version" && status === "accepted" && !finalOne;
    return (
      <div
        key={doc.id}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm last:border-b-0",
          status === "void" && "bg-muted/30 text-muted-foreground",
          doc.id === shown!.id && "bg-primary/5",
        )}
      >
        <div className="min-w-0">
          <p className={cn("font-medium", status === "void" && "line-through")}>
            {kind === "addon" ? "+ " : ""}
            {doc.number || `#${doc.id}`}
            {isCurrent ? (
              <span className="ml-2 rounded-full border border-primary/40 bg-primary/10 px-2 py-px text-[10px] font-medium uppercase tracking-wider text-foreground no-underline">
                {t("billing.version.current")}
              </span>
            ) : null}
            {doc.published !== 1 ? <span className="ml-2 text-xs font-normal">· {t("billing.draft")}</span> : null}
          </p>
          <p className="text-xs">
            {doc.title || "—"} · {formatDate(doc.issued_on, locale)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium tabular-nums", status === "void" && "line-through")}>
            {kind === "addon" ? "+ " : ""}
            {moneyExact(doc.amount, locale)}
          </span>
          <StatusPill file={doc} mode={mode} status={status} />
          <Button type="button" size="sm" variant="outline" onClick={() => setViewingId(doc.id)}>
            {t("billing.file.view")}
          </Button>
          {canMarkFinal ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void toggleFinal(doc, true)}>
              <Stamp className="size-3.5" />
              {t("billing.final.mark")}
            </Button>
          ) : null}
          {mode === "staff" && canManage && kind === "version" && status === "final" ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void toggleFinal(doc, false)}>
              {t("billing.final.unmark")}
            </Button>
          ) : null}
          {pending ? (
            <>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide(doc, "rejected")}>
                <X className="size-3.5" />
                {t("qc.decline")}
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => setSigning(doc)}>
                <PenLine className="size-3.5" />
                {t("billing.approve")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-3">
              <span>
                {shown.kind === "invoice" ? t("billing.kind.invoice") : shown.is_addon === 1 ? t("billing.addon.badge") : t("billing.kind.quote")}{" "}
                {shown.number || `#${shown.id}`}
              </span>
              <StatusPill file={shown} mode={mode} status={shownStatus} />
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {flash ? (
              <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm" role="status">
                {flash}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {shown.title}
                {shown.issued_on ? ` · ${formatDate(shown.issued_on, locale)}` : ""}
                {shown.kind === "invoice" && shown.due_on ? ` · ${t("billing.due")} ${formatDate(shown.due_on, locale)}` : ""}
                {` · ${moneyExact(shown.amount, locale)}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {pendingShown ? (
                  <>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void decide(shown, "rejected")}>
                      <X className="size-3.5" />
                      {t("billing.reject")}
                    </Button>
                    <Button type="button" size="sm" disabled={busy} onClick={() => setSigning(shown)}>
                      <PenLine className="size-3.5" />
                      {t("billing.approve")}
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
                <img src={url} alt={shown.file_name ?? ""} className="mx-auto max-h-[70vh] w-auto" />
              ) : (
                <iframe title={shown.file_name ?? "document"} src={url} className="h-[68vh] w-full bg-white" />
              )}
            </div>

            {isQuote ? (
              <section className="space-y-4 border-t pt-5" aria-label={t("billing.version.title")}>
                <div>
                  <h3 className="font-display text-xl leading-none">{t("billing.version.title")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{finalOne ? t("billing.mods.subtitleFinal") : t("billing.mods.subtitle")}</p>
                </div>

                <div className="overflow-hidden rounded-md border">{[...versions].reverse().map((v) => row(v, "version"))}</div>

                {finalOne || addons.length > 0 ? (
                  <>
                    <div>
                      <h3 className="font-display text-xl leading-none">{t("billing.addon.title")}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t("billing.addon.subtitle")}</p>
                    </div>
                    {addons.length === 0 ? (
                      <p className="rounded-md border border-dashed px-4 py-4 text-sm text-muted-foreground">{t("billing.addon.none")}</p>
                    ) : (
                      <div className="overflow-hidden rounded-md border">{[...addons].reverse().map((a) => row(a, "addon"))}</div>
                    )}
                    <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>{t("billing.totals.final")}</span>
                        <span className="tabular-nums text-foreground">{moneyExact(current.amount, locale)}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>{t("billing.totals.addons")}</span>
                        <span className="tabular-nums text-foreground">+ {moneyExact(acceptedAddons.reduce((sum, a) => sum + a.amount, 0), locale)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t pt-1 font-medium">
                        <span>{t("billing.totals.total")}</span>
                        <span className="tabular-nums">{moneyExact(total, locale)}</span>
                      </div>
                    </div>
                  </>
                ) : null}

                {rootRequests.map((request) => (
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
                    {request.status === "open" && mode === "client" ? <p className="mt-1 text-xs text-muted-foreground">{t("qc.waitingPrice")}</p> : null}
                  </div>
                ))}

                {mode === "client" && !closed ? (
                  <Button type="button" className="w-full sm:w-auto" onClick={() => setRequestOpen(true)}>
                    <MessageSquarePlus className="size-4" />
                    {finalOne ? t("qc.requestButtonFinal") : t("qc.requestButton")}
                  </Button>
                ) : null}
                {mode === "staff" && canManage && !closed && onAddDocument ? (
                  <Button
                    type="button"
                    variant={hasOpenRequest ? "default" : "outline"}
                    className="w-full sm:w-auto"
                    onClick={() => onAddDocument(root, Boolean(finalOne))}
                  >
                    <FileUp className="size-4" />
                    {finalOne ? t("billing.addon.upload") : t("billing.addDocument")}
                  </Button>
                ) : null}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <RequestDialog
        open={requestOpen}
        number={current.number || String(current.id)}
        onClose={() => setRequestOpen(false)}
        onSubmit={async (input) => {
          await createBillingRequest({ file: current, title: input.title, description: input.description, userId });
          await logActivity({
            action: finalOne ? "requested quote add-on" : "requested quote change",
            details: `${current.number || current.id}: ${input.title}`,
            clientId: current.client_id,
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
