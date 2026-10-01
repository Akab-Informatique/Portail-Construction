import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { eq } from "drizzle-orm";
import { Building2, Plus, Search } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { Client, Project } from "@/lib/types";

const emptyForm = {
  name: "",
  company_name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
  status: "active",
};

export function ClientsPage() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    // Always leave the loading state, even if a query fails, so the page
    // never sits on a blank skeleton.
    try {
      await dbReady;
      const allClients = (await db.select().from(schema.clients)) as Client[];
      const allProjects = (await db.select().from(schema.projects)) as Project[];
      let visible = allClients;
      if (user && !user.is_admin && user.user_type === "external") {
        const links = await db
          .select()
          .from(schema.client_users)
          .where(eq(schema.client_users.user_id, user.id));
        const ids = new Set(links.map((l) => l.client_id));
        visible = allClients.filter((c) => ids.has(c.id));
      }
      setClients(visible);
      setProjects(allProjects);
      setLoading(false);
    } catch (err) {
      console.error("ClientsPage load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.company_name, c.name, c.city, c.email].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [clients, query]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim() || !form.name.trim()) return;
    setSaving(true);
    const [row] = await db
      .insert(schema.clients)
      .values({
        name: form.name.trim(),
        company_name: form.company_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
      })
      .returning();
    await logActivity({
      action: "created client",
      details: row.company_name,
      clientId: row.id,
      userId: user?.id,
    });
    setSaving(false);
    setOpen(false);
    setForm(emptyForm);
    await load();
  }

  if (loading) return <PageSkeleton />;

  const canCreate = can("clients", "create");

  return (
    <div>
      <PageHeader
        eyebrow="Accounts"
        title="Clients"
        description="Companies you build for. Open a client to add projects and invite their people."
        actions={
          canCreate ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New client
            </Button>
          ) : null
        }
      />

      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies, contacts, cities…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title={clients.length === 0 ? "No clients yet" : "No matches"}
          description={
            clients.length === 0
              ? "Add the first company you work with. Projects live inside each client."
              : "Try a different name or city."
          }
          action={
            canCreate && clients.length === 0 ? (
              <Button onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                New client
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const jobs = projects.filter((p) => p.client_id === c.id);
            const active = jobs.filter((p) => p.status === "active").length;
            return (
              <Link key={c.id} to={`/clients/${c.id}`} className="group">
                <Card className="h-full gap-4 py-5 transition-colors group-hover:border-primary/35">
                  <div className="flex items-start justify-between gap-3 px-5">
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-semibold tracking-tight">
                        {c.company_name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{c.name}</p>
                    </div>
                    <StatusBadge value={c.status} />
                  </div>
                  <div className="px-5 text-sm text-muted-foreground">
                    {[c.city, c.state].filter(Boolean).join(", ") || "No address on file"}
                    {c.email ? <span className="mt-0.5 block truncate">{c.email}</span> : null}
                  </div>
                  <div className="mx-5 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground tabular-nums">{jobs.length}</span>{" "}
                      project{jobs.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      <span className="font-medium text-foreground tabular-nums">{active}</span> active
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("clients.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreate} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" required>
                <Input
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Primary contact" required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label={t("clients.street")}>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City">
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label={t("clients.province")}>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </Field>
              <Field label="Postal">
                <Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
              </Field>
            </div>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("clients.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("clients.saving") : t("clients.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
