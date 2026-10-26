import { useCallback, useEffect, useMemo, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { Check, Plus, Trash2, Undo2, X } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { useWorkspace } from "@/lib/workspace";
import { formatDate, moneyExact, todayISO } from "@/lib/format";
import { projectColor } from "@/lib/project-colors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Expense = typeof schema.expenses.$inferSelect;
const CATEGORIES = ["materials", "tools", "fuel", "meals", "lodging", "travel", "other"] as const;
const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  reimbursed: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
};

const emptyForm = () => ({ expense_date: todayISO(), category: "materials", vendor: "", description: "", amount: "", project_id: "none" });

/**
 * Employee expenses. Everyone records their own; while an expense is "submitted" its owner can still change or remove it.
 * An administrator sees everyone's and approves, rejects or marks them reimbursed.
 */
export function ExpensesPage() {
  const { t, locale } = useI18n();
  const { user, realUser } = useAuth();
  const { projects } = useWorkspace();
  const isAdmin = Boolean(realUser?.is_admin) && user?.view_as !== "client";
  const [rows, setRows] = useState<Expense[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    await dbReady;
    const all = (await db.select().from(schema.expenses).orderBy(desc(schema.expenses.expense_date), desc(schema.expenses.id))) as Expense[];
    setRows(all);
    if (isAdmin) {
      const people = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
      setNames(Object.fromEntries(people.map((p) => [p.id, p.name])));
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => rows.filter((r) => (scope === "all" && isAdmin ? true : r.user_id === user?.id)), [rows, scope, isAdmin, user?.id]);
  const monthKey = todayISO().slice(0, 7);
  const sum = (list: Expense[]) => list.reduce((s, r) => s + r.amount, 0);
  const cards = [
    { label: t("exp.monthTotal"), value: sum(shown.filter((r) => r.expense_date.startsWith(monthKey) && r.status !== "rejected")) },
    { label: t("exp.pending"), value: sum(shown.filter((r) => r.status === "submitted")) },
    { label: t("exp.toReimburse"), value: sum(shown.filter((r) => r.status === "approved")) },
  ];

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  }
  function openEdit(row: Expense) {
    setEditing(row);
    setForm({
      expense_date: row.expense_date,
      category: row.category,
      vendor: row.vendor ?? "",
      description: row.description ?? "",
      amount: String(row.amount),
      project_id: row.project_id ? String(row.project_id) : "none",
    });
    setError(null);
    setOpen(true);
  }

  async function save() {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) return setError(t("exp.needAmount"));
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const values = {
        expense_date: form.expense_date || todayISO(),
        category: form.category,
        vendor: form.vendor.trim() || null,
        description: form.description.trim() || null,
        amount,
        project_id: form.project_id === "none" ? null : Number(form.project_id),
      };
      if (editing) await db.update(schema.expenses).set(values).where(eq(schema.expenses.id, editing.id));
      else await db.insert(schema.expenses).values({ ...values, user_id: user.id, status: "submitted" });
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(row: Expense, status: string) {
    await db.update(schema.expenses).set({ status }).where(eq(schema.expenses.id, row.id));
    await load();
  }
  async function remove(row: Expense) {
    if (!window.confirm(t("exp.deleteConfirm"))) return;
    await db.delete(schema.expenses).where(eq(schema.expenses.id, row.id));
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
            {(["mine", "all"] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={scope === value ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setScope(value)}>
                {value === "mine" ? t("exp.scopeMine") : t("exp.scopeAll")}
              </Button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button onClick={openNew}>
          <Plus className="size-4" />
          {t("exp.add")}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="gap-1 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{c.label}</p>
            <p className="font-display text-3xl leading-none tabular-nums">{moneyExact(c.value, locale)}</p>
          </Card>
        ))}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("exp.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("exp.date")}</th>
                  {scope === "all" && isAdmin ? <th className="px-3 py-3 font-medium">{t("exp.who")}</th> : null}
                  <th className="px-3 py-3 font-medium">{t("exp.category")}</th>
                  <th className="px-3 py-3 font-medium">{t("exp.project")}</th>
                  <th className="px-3 py-3 text-right font-medium">{t("exp.amount")}</th>
                  <th className="px-3 py-3 font-medium" />
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((row) => {
                  const project = projects.find((p) => p.id === row.project_id);
                  const mine = row.user_id === user?.id;
                  return (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 tabular-nums">{formatDate(row.expense_date, locale)}</td>
                      {scope === "all" && isAdmin ? <td className="px-3 py-3">{names[row.user_id] ?? row.user_id}</td> : null}
                      <td className="px-3 py-3">
                        <p className="font-medium">{t(`exp.cat.${row.category}` as MessageKey)}</p>
                        {row.vendor || row.description ? <p className="text-xs text-muted-foreground">{[row.vendor, row.description].filter(Boolean).join(" · ")}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        {project ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="size-2 rounded-full" style={{ background: projectColor(project) }} />
                            {project.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{moneyExact(row.amount, locale)}</td>
                      <td className="px-3 py-3">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", STATUS_STYLE[row.status])}>{t(`exp.status.${row.status}` as MessageKey)}</span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          {isAdmin && row.status === "submitted" ? (
                            <>
                              <Button size="icon-sm" variant="ghost" title={t("exp.approve")} aria-label={t("exp.approve")} onClick={() => void setStatus(row, "approved")}>
                                <Check className="size-4 text-emerald-600" />
                              </Button>
                              <Button size="icon-sm" variant="ghost" title={t("exp.reject")} aria-label={t("exp.reject")} onClick={() => void setStatus(row, "rejected")}>
                                <X className="size-4 text-red-600" />
                              </Button>
                            </>
                          ) : null}
                          {isAdmin && row.status === "approved" ? (
                            <Button size="sm" variant="outline" onClick={() => void setStatus(row, "reimbursed")}>
                              {t("exp.reimburse")}
                            </Button>
                          ) : null}
                          {isAdmin && (row.status === "rejected" || row.status === "reimbursed") ? (
                            <Button size="icon-sm" variant="ghost" title={t("exp.status.submitted")} aria-label={t("exp.status.submitted")} onClick={() => void setStatus(row, "submitted")}>
                              <Undo2 className="size-4" />
                            </Button>
                          ) : null}
                          {mine && row.status === "submitted" ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                                {t("exp.edit")}
                              </Button>
                              <Button size="icon-sm" variant="ghost" title={t("exp.delete")} aria-label={t("exp.delete")} onClick={() => void remove(row)}>
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("exp.edit") : t("exp.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-date">{t("exp.date")}</Label>
                <Input id="exp-date" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-amount">{t("exp.amount")}</Label>
                <Input id="exp-amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("exp.category")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`exp.cat.${c}` as MessageKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("exp.project")}</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("exp.noProject")}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-vendor">{t("exp.vendor")}</Label>
              <Input id="exp-vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-note">{t("exp.note")}</Label>
              <Input id="exp-note" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("clients.cancel")}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {t("settings.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
