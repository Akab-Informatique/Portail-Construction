import { useEffect, useMemo, useState } from "react";
import { and, eq } from "drizzle-orm";
import { Loader2, Save } from "lucide-react";
import { db, schema } from "../../db";
import { useI18n } from "@/lib/i18n";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import type { Client, Project, User } from "@/lib/types";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Who is assigned to this project. An employee only sees the projects they are assigned to, and a client user only
 * the projects of their company they are assigned to. Administrators manage it here.
 */
export function ProjectTeamDialog({
  open,
  project,
  client,
  people,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: Project;
  client: Client | null;
  people: User[];
  members: { user_id: number; role: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [clientUserIds, setClientUserIds] = useState<number[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(members.map((m) => m.user_id));
    void db
      .select({ user_id: schema.client_users.user_id })
      .from(schema.client_users)
      .where(eq(schema.client_users.client_id, project.client_id))
      .then((rows) => setClientUserIds(rows.map((r) => r.user_id)));
  }, [open, members, project.client_id]);

  const staff = useMemo(() => people.filter((p) => p.user_type === "internal" && p.is_active === 1).sort((a, b) => a.name.localeCompare(b.name)), [people]);
  const clientUsers = useMemo(() => people.filter((p) => clientUserIds.includes(p.id) && p.is_active === 1).sort((a, b) => a.name.localeCompare(b.name)), [people, clientUserIds]);

  const toggle = (id: number, on: boolean) => setPicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  async function save() {
    setBusy(true);
    try {
      const had = new Set(members.map((m) => m.user_id));
      const want = new Set(picked);
      for (const id of had) if (!want.has(id)) await db.delete(schema.project_members).where(and(eq(schema.project_members.project_id, project.id), eq(schema.project_members.user_id, id)));
      for (const id of want) {
        if (had.has(id)) continue;
        const person = people.find((p) => p.id === id);
        await db.insert(schema.project_members).values({ project_id: project.id, user_id: id, role: person?.title || (person?.user_type === "internal" ? "Staff" : "Client") });
      }
      await logActivity({ action: "changed project team", details: `${picked.length}`, projectId: project.id, userId: user?.id });
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const group = (title: string, list: User[]) => (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
          {list.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                <Checkbox checked={picked.includes(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
                <UserAvatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.title || p.email}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("team.manage")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          {group(t("team.staff"), staff)}
          {group(client ? `${t("team.clientUsers")} · ${client.company_name}` : t("team.clientUsers"), clientUsers)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("clients.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
