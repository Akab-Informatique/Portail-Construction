import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, FileDown, FileText, Plus, Search, Trash2, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { deleteSop, exportSopHtml, exportSopPdf, listSops, loadSop, parseSteps } from "@/lib/sop";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Row = Awaited<ReturnType<typeof listSops>>[number];

/** The binder of procedures: every SOP made in the portal, ready to open, export (PDF or one self-contained page) and share. */
export function SopsPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => setRows(await listSops()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => [...new Set((rows ?? []).map((r) => r.category).filter((c): c is string => !!c))].sort(), [rows]);
  const shown = (rows ?? []).filter((r) => (!category || r.category === category) && (!query.trim() || `${r.title} ${r.description ?? ""} ${r.category ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())));

  async function exportAs(row: Row, kind: "pdf" | "html") {
    setBusy(row.id);
    try {
      const full = await loadSop(row.id);
      if (!full) return;
      const input = {
        title: full.title,
        description: full.description ?? "",
        category: full.category ?? "",
        steps: parseSteps(full.steps),
        author: user?.name,
        date: formatDate(full.updated_at.toISOString().slice(0, 10), locale),
        stepLabel: t("sop.step"),
        heading: t("sop.heading"),
      };
      if (kind === "pdf") await exportSopPdf(input);
      else exportSopHtml(input);
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(t("sop.deleteConfirm", { name: row.title }))) return;
    await deleteSop(row.id);
    await load();
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("nav.setup")}
        title={t("sop.title")}
        description={t("sop.subtitle")}
        actions={
          <Button onClick={() => navigate("/sops/new")}>
            <Plus className="size-4" />
            {t("sop.new")}
          </Button>
        }
      />

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={query} placeholder={t("sop.search")} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {categories.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {["", ...categories].map((c) => (
                <button
                  key={c || "all"}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", category === c ? "border-primary bg-primary/15" : "text-muted-foreground hover:bg-muted")}
                >
                  {c || t("sch.filter.all")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-5" />}
          title={rows.length === 0 ? t("sop.none") : t("sop.noMatch")}
          description={rows.length === 0 ? t("sop.noneHint") : ""}
          action={
            rows.length === 0 ? (
              <Button onClick={() => navigate("/sops/new")}>
                <Plus className="size-4" />
                {t("sop.new")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <Card key={r.id} className="group gap-0 overflow-hidden p-0">
              <button type="button" onClick={() => navigate(`/sops/${r.id}`)} className="block w-full text-left">
                <div className="flex aspect-[16/9] items-center justify-center overflow-hidden border-b bg-muted/40">
                  {r.cover ? <img src={r.cover} alt="" className="size-full object-cover" /> : <BookOpen className="size-8 text-muted-foreground/60" />}
                </div>
                <div className="space-y-1 p-4">
                  {r.category ? <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{r.category}</p> : null}
                  <p className="font-medium leading-snug">{r.title}</p>
                  {r.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{r.description}</p> : null}
                  <p className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    {t("sop.steps", { n: r.step_count })}
                    {r.has_video === 1 ? (
                      <span className="inline-flex items-center gap-1">
                        <Video className="size-3.5" />
                        {t("sop.video")}
                      </span>
                    ) : null}
                    · {formatDate(r.updated_at.toISOString().slice(0, 10), locale)}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-1 border-t px-3 py-2">
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void exportAs(r, "pdf")}>
                  <FileDown className="size-4" />
                  PDF
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void exportAs(r, "html")} title={t("sop.htmlHint")}>
                  <FileText className="size-4" />
                  {t("sop.shareFile")}
                </Button>
                <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={t("exp.delete")} title={t("exp.delete")} onClick={() => void remove(r)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
