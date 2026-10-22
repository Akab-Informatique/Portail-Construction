import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";
import { useAuth } from "@/lib/auth";
import { MODULES } from "@/lib/constants";
import { writeGroupFlags } from "@/lib/access";
import { logActivity } from "@/lib/activity";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import type {
  AccessGroup,
  AccessGroupAudience,
  AccessGroupPermission,
  UserAccessGroup,
} from "@/lib/types";
import type { MessageKey } from "@/lib/i18n/en";

type Flags = { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };
const EMPTY: Flags = { can_view: false, can_create: false, can_edit: false, can_delete: false };

function fromRow(row?: AccessGroupPermission): Flags {
  if (!row) return { ...EMPTY };
  return {
    can_view: row.can_view === 1,
    can_create: row.can_create === 1,
    can_edit: row.can_edit === 1,
    can_delete: row.can_delete === 1,
  };
}

export function GroupsEditor({
  compact = false,
  audience,
}: {
  compact?: boolean;
  audience: Exclude<AccessGroupAudience, "both">;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [perms, setPerms] = useState<AccessGroupPermission[]>([]);
  const [memberships, setMemberships] = useState<UserAccessGroup[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(keepId?: number | null) {
    await dbReady;
    const raw = (await db.select().from(schema.access_groups)) as AccessGroup[];
    const seen = new Set<string>();
    const g = raw
      .slice()
      .sort((a, b) => a.id - b.id)
      .filter((group) => group.audience === audience)
      .filter((group) => {
        const key = group.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const p = (await db.select().from(schema.access_group_permissions)) as AccessGroupPermission[];
    const m = (await db.select().from(schema.user_access_groups)) as UserAccessGroup[];
    setGroups(g);
    setPerms(p);
    setMemberships(m);
    setSelectedId((prev) => {
      const want = keepId ?? prev;
      if (want && g.some((x) => x.id === want)) return want;
      return g[0]?.id ?? null;
    });
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const selected = groups.find((g) => g.id === selectedId) ?? null;
  const selectedPerms = useMemo(
    () => perms.filter((p) => p.group_id === selectedId),
    [perms, selectedId],
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    const [row] = await db
      .insert(schema.access_groups)
      .values({
        name: newName.trim(),
        description: newDesc.trim() || null,
        audience,
        all_clients: audience === "external" ? 0 : 1,
      })
      .returning();
    await logActivity({ action: "created access group", details: row.name, userId: user?.id });
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    setBusy(false);
    await load(row.id);
  }

  async function saveMeta(patch: Partial<AccessGroup>) {
    if (!selected) return;
    await db.update(schema.access_groups).set(patch).where(eq(schema.access_groups.id, selected.id));
    setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, ...patch } : g)));
  }

  async function toggleFlag(module: string, flags: Flags) {
    if (!selected) return;
    await writeGroupFlags(selected.id, module, flags);
    const rows = (await db
      .select()
      .from(schema.access_group_permissions)
      .where(eq(schema.access_group_permissions.group_id, selected.id))) as AccessGroupPermission[];
    setPerms((prev) => [...prev.filter((p) => p.group_id !== selected.id), ...rows]);
  }

  async function onDelete() {
    if (!selected) return;
    const ok = window.confirm(t("config.groups.deleteConfirm", { name: selected.name }));
    if (!ok) return;
    await db.delete(schema.access_group_permissions).where(eq(schema.access_group_permissions.group_id, selected.id));
    await db.delete(schema.access_group_clients).where(eq(schema.access_group_clients.group_id, selected.id));
    await db.delete(schema.user_access_groups).where(eq(schema.user_access_groups.group_id, selected.id));
    await db.delete(schema.access_groups).where(eq(schema.access_groups.id, selected.id));
    await load(null);
  }

  return (
    <div>
      {!compact && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("config.groups.new")}
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-5" />}
          title={t(audience === "internal" ? "config.groups.empty.internal" : "config.groups.empty.external")}
          description={t(
            audience === "internal" ? "config.groups.empty.internalDesc" : "config.groups.empty.externalDesc",
          )}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t("config.groups.new")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-1">
            {compact && (
              <Button className="mb-2 w-full" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t("config.groups.new")}
              </Button>
            )}
            {groups.map((g) => {
              const count = memberships.filter((m) => m.group_id === g.id).length;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedId(g.id)}
                  className={`flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors ${
                    g.id === selectedId
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="text-sm font-medium">{g.name}</span>
                  <span className={`text-[11px] ${g.id === selectedId ? "opacity-70" : ""}`}>
                    {t("config.groups.members", { n: count })}
                  </span>
                </button>
              );
            })}
          </aside>

          {selected && (
            <div className="space-y-5">
              <Card className="gap-4 p-5">
                <div className="space-y-1.5">
                  <Label>{t("config.groups.name")}</Label>
                  <Input
                    defaultValue={selected.name}
                    key={`name-${selected.id}`}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== selected.name) void saveMeta({ name });
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("config.groups.description")}</Label>
                  <Textarea
                    key={`desc-${selected.id}`}
                    defaultValue={selected.description ?? ""}
                    rows={2}
                    onBlur={(e) => {
                      const description = e.target.value.trim() || null;
                      if (description !== selected.description) void saveMeta({ description });
                    }}
                  />
                </div>
              </Card>

              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("people.col.module")}</th>
                      <th className="px-3 py-3 font-medium">{t("people.col.view")}</th>
                      <th className="px-3 py-3 font-medium">{t("people.col.create")}</th>
                      <th className="px-3 py-3 font-medium">{t("people.col.edit")}</th>
                      <th className="px-3 py-3 font-medium">{t("people.col.delete")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {MODULES.map((m) => {
                      const flags = fromRow(selectedPerms.find((p) => p.module === m.id));
                      const set = (key: keyof Flags, value: boolean) => {
                        const next = { ...flags, [key]: value };
                        if (key !== "can_view" && value) next.can_view = true;
                        if (key === "can_view" && !value) {
                          next.can_create = false;
                          next.can_edit = false;
                          next.can_delete = false;
                        }
                        void toggleFlag(m.id, next);
                      };
                      return (
                        <tr key={m.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <p className="font-medium">{t(`module.${m.id}` as MessageKey)}</p>
                            <p className="text-xs text-muted-foreground">
                              {t(`module.${m.id}.desc` as MessageKey)}
                            </p>
                          </td>
                          {(["can_view", "can_create", "can_edit", "can_delete"] as const).map((k) => (
                            <td key={k} className="px-3 py-3">
                              <Checkbox
                                checked={flags[k]}
                                onCheckedChange={(v) => set(k, v === true)}
                                aria-label={`${m.label} ${k.replace("can_", "")}`}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => void onDelete()}>
                  {t("config.groups.delete")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onCreate}>
            <DialogHeader>
              <DialogTitle>{t("config.groups.new")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-1.5">
                <Label>{t("config.groups.name")}</Label>
                <Input required value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("config.groups.description")}</Label>
                <Textarea rows={2} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("people.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("config.groups.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
