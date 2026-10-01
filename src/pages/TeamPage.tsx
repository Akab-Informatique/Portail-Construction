import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Users } from "lucide-react";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useI18n } from "@/lib/i18n";
import type { User } from "@/lib/types";

const empty = {
  name: "",
  email: "",
  password: "frx123",
  title: "",
  phone: "",
  user_type: "internal" as "internal" | "external",
  is_admin: false,
};

export function TeamPage() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "internal" | "external">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    // Always leave the loading state, even if a query fails, so the page
    // never sits on a blank skeleton.
    try {
      await dbReady;
      const rows = (await db.select().from(schema.users)) as User[];
      setPeople(rows);
      setLoading(false);
    } catch (err) {
      console.error("TeamPage load failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return people.filter((p) => {
      if (filter !== "all" && p.user_type !== filter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [p.name, p.email, p.title].some((v) => v?.toLowerCase().includes(q));
    });
  }, [people, query, filter]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await db.insert(schema.users).values({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password || "frx123",
      user_type: form.user_type,
      title: form.title.trim() || null,
      phone: form.phone.trim() || null,
      is_active: 1,
      is_admin: form.is_admin && form.user_type === "internal" ? 1 : 0,
      avatar_initials: initials(form.name.trim()),
      locale: "en",
      theme: "light",
      all_clients: form.user_type === "internal" ? 1 : 0,
    });
    await logActivity({
      action: "created user",
      details: `${form.name} (${form.user_type})`,
      userId: user?.id,
    });
    setSaving(false);
    setOpen(false);
    setForm(empty);
    await load();
  }

  if (loading) return <PageSkeleton />;

  const allowed = user?.is_admin || can("users", "view");
  if (!allowed) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title={t("people.restricted")}
        description={t("people.restrictedDesc")}
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Directory"
        title="People"
        description="Internal employees and external client users. Open anyone to set module-level access."
        actions={
          (user?.is_admin || can("users", "create")) && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New user
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          {(["all", "internal", "external"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No people match"
          description="Adjust the filter or create a user."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/team/${p.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50"
                >
                  <UserAvatar name={p.name} hint={p.avatar_initials} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {p.name}
                      {p.is_admin ? (
                        <span className="ml-2 text-[11px] font-medium text-primary">Admin</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.title || "—"} · {p.email}
                    </p>
                  </div>
                  <StatusBadge value={p.user_type} />
                  <StatusBadge value={p.is_active ? "active" : "inactive"} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreate} className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("people.titleField")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("people.phone")}</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.user_type}
                onValueChange={(v) =>
                  setForm({ ...form, user_type: v as "internal" | "external", is_admin: false })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal employee</SelectItem>
                  <SelectItem value="external">External (client)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Temporary password</Label>
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {form.user_type === "internal" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_admin}
                  onChange={(e) => setForm({ ...form, is_admin: e.target.checked })}
                />
                {t("people.adminCheck")}
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
