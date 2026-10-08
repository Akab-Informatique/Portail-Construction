import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquareMore } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BILLING_FILES_EVENT, listBillingFiles, listBillingRequests, markBillingSeen } from "@/lib/billing-files";
import { formatDate, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type { BillingFile, BillingRequest } from "@/lib/types";

const POLL_MS = 45_000;

type Item = {
  key: string;
  label: string;
  number: string;
  title: string;
  clientId: number;
  when: string;
  amount: number;
  /** The quote/invoice to open. */
  fileId: number;
  requestId?: number;
  seenFileId?: number;
};

/**
 * Little speech-bubble in the top bar.
 * Staff: new client change requests and the client's decisions on quotes/annexes.
 * Clients: quotes and annexes waiting for their approval.
 */
export function ChangeNotifications() {
  const { user, can } = useAuth();
  const { clients } = useWorkspace();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [files, setFiles] = useState<BillingFile[]>([]);
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isClient = user?.user_type === "external";
  const isStaff = Boolean(user && !isClient && (user.is_admin || can("billing", "view")));
  const enabled = isClient || isStaff;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [f, r] = await Promise.all([listBillingFiles(), listBillingRequests()]);
      setFiles(f);
      setRequests(r);
    } catch (err) {
      console.error("notifications failed", err);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onEvent = () => void refresh();
    window.addEventListener(BILLING_FILES_EVENT, onEvent);
    window.addEventListener("focus", onEvent);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(BILLING_FILES_EVENT, onEvent);
      window.removeEventListener("focus", onEvent);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const visibleClientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);
  const items = useMemo<Item[]>(() => {
    const inScope = (clientId: number) => clients.length === 0 || visibleClientIds.has(clientId);
    const rootOf = (f: BillingFile) => f.parent_id ?? f.id;
    const out: Item[] = [];
    if (isClient) {
      for (const f of files) {
        if (f.published !== 1 || f.kind !== "quote" || f.status !== "sent" || !inScope(f.client_id)) continue;
        out.push({
          key: `f${f.id}`,
          label: f.parent_id ? t("qc.notify.proposed") : t("billing.notify.quoteToApprove"),
          number: f.number || `#${f.id}`,
          title: f.title,
          clientId: f.client_id,
          when: f.created_at ? String(f.created_at) : "",
          amount: f.amount,
          fileId: rootOf(f),
        });
      }
    } else {
      for (const r of requests) {
        if (r.staff_seen !== 0 || !inScope(r.client_id)) continue;
        out.push({
          key: `r${r.id}`,
          label: t("qc.notify.requested"),
          number: r.number,
          title: r.title,
          clientId: r.client_id,
          when: r.requested_at ?? String(r.created_at),
          amount: 0,
          fileId: r.file_id,
          requestId: r.id,
        });
      }
      for (const f of files) {
        if (f.staff_seen !== 0 || (f.status !== "accepted" && f.status !== "rejected") || !inScope(f.client_id)) continue;
        const accepted = f.status === "accepted";
        out.push({
          key: `f${f.id}`,
          label: f.parent_id
            ? accepted ? t("qc.notify.approved") : t("qc.notify.rejected")
            : accepted ? t("billing.notify.quoteAccepted") : t("billing.notify.quoteDeclined"),
          number: f.number || `#${f.id}`,
          title: f.title,
          clientId: f.client_id,
          when: f.accepted_at ?? String(f.created_at),
          amount: f.amount,
          fileId: rootOf(f),
          seenFileId: f.id,
        });
      }
    }
    return out.sort((a, b) => b.when.localeCompare(a.when));
  }, [files, requests, isClient, visibleClientIds, clients.length, t]);

  if (!enabled) return null;

  function go(item: Item) {
    setOpen(false);
    navigate(isClient ? `/clients/${item.clientId}/billing?file=${item.fileId}` : `/finance/billing?file=${item.fileId}`);
  }

  async function markAll() {
    await markBillingSeen({
      requestIds: items.filter((i) => i.requestId).map((i) => i.requestId as number),
      fileIds: items.filter((i) => i.seenFileId).map((i) => i.seenFileId as number),
    });
  }

  const count = items.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("qc.notify.open")}
        aria-label={`${t("qc.notify.open")}${count ? ` (${count})` : ""}`}
        className="relative flex size-8 items-center justify-center rounded-sm border bg-card text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquareMore className="size-4" />
        {count > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-50 w-80 max-w-[92vw] border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="font-display text-base leading-none">{t("qc.notify.title")}</p>
            {isStaff && count > 0 ? (
              <button type="button" onClick={() => void markAll()} className="text-[11px] text-muted-foreground hover:text-foreground">
                {t("qc.notify.markAll")}
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("qc.notify.empty")}</p>
            ) : (
              <ul className="divide-y">
                {items.map((item) => {
                  const client = clients.find((c) => c.id === item.clientId);
                  return (
                    <li key={item.key}>
                      <button type="button" onClick={() => go(item)} className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">{item.label}</span>
                        <span className="text-sm font-medium">
                          {item.number} · {item.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {client?.company_name ?? ""}
                          {client ? " · " : ""}
                          {formatDate(item.when, locale)}
                          {item.amount > 0 ? ` · ${money(item.amount, locale)}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
