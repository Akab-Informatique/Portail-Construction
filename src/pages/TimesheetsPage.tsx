import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, Loader2, Pencil, Timer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { formatDate, formatDateTime } from "@/lib/format";
import { addDaysISO, editTimeEntry, formatDuration, loadAllPunches, loadUserPunches, pairPunches, weekStartISO, type TimeEntry } from "@/lib/timeclock";
import { downloadBlob } from "@/lib/download";
import type { TimePunch, User } from "@/lib/types";
import { db, dbReady, schema } from "../db";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export function TimesheetsPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { projects, clients } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [punches, setPunches] = useState<TimePunch[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [week, setWeek] = useState(weekStartISO());
  const [personId, setPersonId] = useState<string>("me");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIds, setExportIds] = useState<number[]>([]);

  const isAdmin = Boolean(user?.is_admin);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        await dbReady;
        if (isAdmin) {
          setPeople(((await db.select().from(schema.users)) as User[]).filter((p) => p.user_type === "internal"));
          setPunches(await loadAllPunches());
        } else {
          setPunches(await loadUserPunches(user.id));
        }
      } catch (err) {
        console.error("timesheet load failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id, isAdmin, version]);

  const weekEnd = addDaysISO(week, 7);
  const scoped = useMemo(() => {
    const uid = isAdmin && personId !== "me" ? Number(personId) : user?.id;
    return punches.filter((p) => {
      if (uid && p.user_id !== uid) return false;
      const day = p.punched_at.slice(0, 10);
      return day >= week && day < weekEnd;
    });
  }, [punches, personId, isAdmin, user?.id, week, weekEnd]);

  const entries = useMemo(() => pairPunches(scoped), [scoped]);
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);

  function csvEscape(value: string) {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }

  function openExport() {
    const current = isAdmin && personId !== "me" ? Number(personId) : user?.id;
    setExportIds(current ? [current] : []);
    setExportOpen(true);
  }

  function toggleExportId(id: number) {
    setExportIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  }

  function exportCsv() {
    const weekPunches = punches.filter((p) => {
      const day = p.punched_at.slice(0, 10);
      return day >= week && day < weekEnd;
    });
    const selected = new Set(exportIds);
    const source = selected.size === 0 ? weekPunches : weekPunches.filter((p) => selected.has(p.user_id));
    const rows = pairPunches(source);
    const header = [
      t("timesheet.employeeCol"),
      t("timesheet.day"),
      t("billing.project"),
      "Project #",
      t("punch.in"),
      t("punch.out"),
      t("timesheet.hours"),
      t("billing.status"),
    ];
    const lines = [header.join(",")];
    for (const entry of rows) {
      const project = projects.find((p) => p.id === entry.punchIn.project_id);
      const person =
        people.find((p) => p.id === entry.punchIn.user_id)?.name ??
        (entry.punchIn.user_id === user?.id ? user?.name : "") ??
        String(entry.punchIn.user_id);
      const hours = entry.open ? "" : (entry.minutes / 60).toFixed(2);
      lines.push(
        [
          csvEscape(person),
          csvEscape(entry.punchIn.punched_at.slice(0, 10)),
          csvEscape(project?.name ?? ""),
          csvEscape(project?.project_number ?? ""),
          csvEscape(entry.punchIn.punched_at),
          csvEscape(entry.punchOut?.punched_at ?? ""),
          hours,
          entry.open ? "open" : "complete",
        ].join(","),
      );
    }
    const who = exportIds.length === 0 || exportIds.length === people.length ? "all" : `${exportIds.length}staff`;
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `timesheet-${week}-${who}.csv`);
    setExportOpen(false);
  }

  const localInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  function openEdit(entry: TimeEntry) {
    setEditing(entry);
    setEditIn(localInput(entry.punchIn.punched_at));
    setEditOut(entry.punchOut ? localInput(entry.punchOut.punched_at) : "");
    setEditReason("");
    setEditError(null);
  }

  async function saveEdit() {
    if (!editing || !user) return;
    setEditBusy(true);
    setEditError(null);
    const result = await editTimeEntry({
      entry: editing,
      inAt: new Date(editIn).toISOString(),
      outAt: editing.punchOut && editOut ? new Date(editOut).toISOString() : null,
      reason: editReason,
      userId: user.id,
    });
    setEditBusy(false);
    if (!result.ok) return setEditError(t((result.error.startsWith("punch.error.") ? result.error : "punch.error.failed") as never));
    setEditing(null);
    setVersion((v) => v + 1);
  }

  const byProject = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of entries) {
      map.set(entry.punchIn.project_id, (map.get(entry.punchIn.project_id) ?? 0) + entry.minutes);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  if (loading) return <PageSkeleton />;
  if (user?.user_type === "external") {
    return (
      <EmptyState
        icon={<Timer className="size-5" />}
        title={t("timesheet.restricted")}
        description={t("timesheet.restrictedDesc")}
      />
    );
  }

  return (
    <div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>{t("timesheet.week")}</Label>
          <Input type="date" value={week} onChange={(e) => setWeek(weekStartISO(new Date(`${e.target.value}T00:00:00`)))} />
        </div>
        {isAdmin ? (
          <div className="space-y-1.5">
            <Label>{t("timesheet.employee")}</Label>
            <Select value={personId} onValueChange={setPersonId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me">{user?.name ?? t("timesheet.me")}</SelectItem>
                {people
                  .filter((p) => p.id !== user?.id)
                  .map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {isAdmin ? (
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={openExport}>
            <Download className="size-3.5" />
            {t("timesheet.export")}
          </Button>
        ) : null}
        <p className="pb-2 text-sm text-muted-foreground">
          {formatDate(week, locale)} – {formatDate(addDaysISO(week, 6), locale)}
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="gap-1 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("timesheet.total")}</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{formatDuration(total)}</p>
          <p className="text-xs text-muted-foreground">{t("timesheet.entries", { n: entries.length })}</p>
        </Card>
        {byProject.slice(0, 2).map(([id, minutes]) => {
          const project = projects.find((p) => p.id === id);
          return (
            <Card key={id} className="gap-1 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {project?.project_number ?? t("billing.project")}
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums">{formatDuration(minutes)}</p>
              <p className="truncate text-xs text-muted-foreground">{project?.name}</p>
            </Card>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-5" />}
          title={t("timesheet.empty")}
          description={t("timesheet.emptyDesc")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("timesheet.day")}</th>
                <th className="px-4 py-3 font-medium">{t("billing.project")}</th>
                <th className="px-4 py-3 font-medium">{t("punch.in")}</th>
                <th className="px-4 py-3 font-medium">{t("punch.out")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("timesheet.hours")}</th>
                <th className="px-4 py-3 font-medium">{t("billing.status")}</th>
                <th className="w-12 px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => {
                const project = projects.find((p) => p.id === entry.punchIn.project_id);
                const client = clients.find((c) => c.id === project?.client_id);
                return (
                  <tr key={entry.punchIn.id}>
                    <td className="px-4 py-3 tabular-nums">{formatDate(entry.punchIn.punched_at, locale)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{project?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {project?.project_number}
                        {client ? ` · ${client.company_name}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDateTime(entry.punchIn.punched_at, locale)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {entry.punchOut ? formatDateTime(entry.punchOut.punched_at, locale) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {entry.open ? "—" : formatDuration(entry.minutes)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={entry.open ? "in_progress" : "complete"} />
                    </td>
                    <td className="px-2 py-3 text-right">
                      {entry.punchIn.user_id === user?.id || isAdmin ? (
                        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("timesheet.edit")} title={t("timesheet.edit")} onClick={() => openEdit(entry)}>
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("timesheet.editTitle")}</DialogTitle>
            <DialogDescription>{t("timesheet.logged")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>{t("punch.in")}</Label>
              <Input type="datetime-local" value={editIn} onChange={(e) => setEditIn(e.target.value)} />
            </div>
            {editing?.punchOut ? (
              <div className="space-y-1.5">
                <Label>{t("punch.out")}</Label>
                <Input type="datetime-local" value={editOut} onChange={(e) => setEditOut(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>{t("timesheet.reason")}</Label>
              <Input correct value={editReason} onChange={(e) => setEditReason(e.target.value)} />
            </div>
            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("clients.cancel")}
            </Button>
            <Button onClick={() => void saveEdit()} disabled={editBusy || !editIn || !editReason.trim()}>
              {editBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("timesheet.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("timesheet.exportTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("timesheet.exportHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {exportIds.length === people.length && people.length > 0
                ? t("timesheet.exportEveryone")
                : t("timesheet.exportCount", { n: exportIds.length })}
            </p>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setExportIds(people.map((p) => p.id))}>
                {t("timesheet.exportAll")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setExportIds([])}>
                {t("timesheet.exportNone")}
              </Button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border">
            {people.map((p) => {
              const checked = exportIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    onChange={() => toggleExportId(p.id)}
                  />
                  <span className="text-sm">{p.name}</span>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setExportOpen(false)}>
              {t("timesheet.exportCancel")}
            </Button>
            <Button type="button" onClick={exportCsv} disabled={exportIds.length === 0 && people.length > 0}>
              <Download className="size-4" />
              {t("timesheet.exportDownload")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
