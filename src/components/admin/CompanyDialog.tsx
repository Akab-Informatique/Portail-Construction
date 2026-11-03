import { FormEvent, useEffect, useState } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { logActivity } from "@/lib/activity";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMPTY = { company_name: "", name: "", email: "", phone: "", address: "", city: "", state: "", zip: "", notes: "", status: "active" };

/** Create or change a client company. A company holds no rights: those belong to the people inside it. */
export function CompanyDialog({ open, company, onClose, onSaved }: { open: boolean; company: Client | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(
      company
        ? { company_name: company.company_name, name: company.name, email: company.email ?? "", phone: company.phone ?? "", address: company.address ?? "", city: company.city ?? "", state: company.state ?? "", zip: company.zip ?? "", notes: company.notes ?? "", status: company.status }
        : EMPTY,
    );
  }, [open, company]);

  const set = (patch: Partial<typeof EMPTY>) => setF((cur) => ({ ...cur, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.company_name.trim() || !f.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        company_name: f.company_name.trim(),
        name: f.name.trim(),
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        address: f.address.trim() || null,
        city: f.city.trim() || null,
        state: f.state.trim() || null,
        zip: f.zip.trim() || null,
        notes: f.notes.trim() || null,
        status: f.status,
      };
      if (company) {
        await db.update(schema.clients).set(payload).where(eq(schema.clients.id, company.id));
        await logActivity({ action: "updated client", details: payload.company_name, clientId: company.id, userId: user?.id });
        onSaved(company.id);
      } else {
        const [row] = await db.insert(schema.clients).values(payload).returning();
        await logActivity({ action: "created client", details: row.company_name, clientId: row.id, userId: user?.id });
        onSaved(row.id);
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof typeof EMPTY, props: React.ComponentProps<"input"> = {}) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={f[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof EMPTY>)} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl uppercase tracking-wide">{company ? t("config.clients.edit") : t("clients.new")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t("adm.company.noRights")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field(t("clients.company"), "company_name", { required: true })}
            {field(t("clients.primaryContact"), "name", { required: true })}
            {field(t("clients.email"), "email", { type: "email" })}
            {field(t("clients.phone"), "phone")}
          </div>
          {field(t("clients.street"), "address")}
          <div className="grid gap-4 sm:grid-cols-3">
            {field(t("clients.city"), "city")}
            {field(t("clients.province"), "state")}
            {field(t("clients.postal"), "zip")}
          </div>
          <div className="space-y-1.5">
            <Label>{t("clients.status")}</Label>
            <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="active">{t("status.active")}</option>
              <option value="prospect">{t("status.prospect")}</option>
              <option value="inactive">{t("status.inactive")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("clients.notes")}</Label>
            <Textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("clients.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("clients.saving") : company ? t("config.clients.save") : t("clients.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
