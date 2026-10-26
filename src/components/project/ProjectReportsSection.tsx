import { useMemo, useState } from "react";
import { Download, Mail, Plus, Presentation, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/EmptyState";
import { ComposeEmailDialog, type ComposeDraft } from "@/components/ComposeEmailDialog";
import { useI18n } from "@/lib/i18n";
import { sendInvoiceEmail } from "@/lib/mail";
import { getSmtpSettings, smtpReady } from "@/lib/settings";
import { downloadReportPdf, reportPdfBase64 } from "@/lib/report-pdf";
import {
  REPORT_SECTIONS,
  STANDARD_REPORTS,
  buildReport,
  type BuiltReport,
  type ReportPack,
  type ReportSectionId,
} from "@/lib/project-report";
import type { Client, CompanyProfile, Project, SmtpSettings } from "@/lib/types";

type SavedReport = { id: number; name: string; sections: string };

export function ProjectReportsSection({
  project,
  client,
  company,
  pack,
  saved,
  canCreate,
  preparedBy,
  onSaveCustom,
  onDeleteCustom,
}: {
  project: Project;
  client: Client | null;
  company: CompanyProfile;
  pack: ReportPack;
  saved: SavedReport[];
  canCreate: boolean;
  preparedBy: string;
  onSaveCustom: (name: string, sections: ReportSectionId[]) => Promise<void>;
  onDeleteCustom: (id: number) => Promise<void>;
}) {
  const { t, locale, tr } = useI18n();
  const [customName, setCustomName] = useState("");
  const [picked, setPicked] = useState<ReportSectionId[]>(["snapshot", "schedule", "budget"]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ report: BuiltReport; draft: ComposeDraft } | null>(null);

  const make = (title: string, sections: ReportSectionId[]) =>
    buildReport({
      title,
      sections,
      project,
      client,
      company,
      pack,
      locale,
      preparedBy,
      t: (key, vars) => t(key as never, vars as never),
    });

  async function exportPdf(report: BuiltReport) {
    downloadReportPdf(report, locale);
  }

  async function openSend(report: BuiltReport) {
    const smtp = await getSmtpSettings();
    if (!smtpReady(smtp)) {
      setNotice(t("reports.smtpMissing"));
      return;
    }
    setCompose({
      report,
      draft: {
        to: client?.email ? [client.email] : [],
        subject: t("reports.mail.subject", { title: report.title, number: project.project_number }),
        body: t("reports.mail.body", { title: report.title, project: project.name, company: company.legal_name }),
      },
    });
  }

  async function sendComposed(smtp: SmtpSettings) {
    if (!compose) return;
    if (compose.draft.to.length === 0) {
      setNotice(t("mail.compose.needTo"));
      return;
    }
    try {
      setBusy(true);
      await sendInvoiceEmail({
        smtp,
        to: compose.draft.to,
        subject: compose.draft.subject,
        text: compose.draft.body,
        filename: `${project.project_number}-report.pdf`,
        pdfBase64: reportPdfBase64(compose.report, locale),
      });
      setNotice(t("reports.sent", { email: compose.draft.to.join(", ") }));
      setCompose(null);
    } catch (err) {
      setNotice(tr(err, "reports.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const parsedSaved = useMemo(
    () =>
      saved.map((row) => ({
        ...row,
        ids: row.sections.split(",").filter((s): s is ReportSectionId => REPORT_SECTIONS.some((x) => x.id === s)),
      })),
    [saved],
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">{t("reports.title")}</h2>
        {notice ? <p className="mt-2 text-sm text-muted-foreground">{notice}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {STANDARD_REPORTS.map((std) => {
          const report = make(t(std.titleKey as never), std.sections);
          return (
            <Card key={std.id} className="gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("reports.standard")}
                  </p>
                  <h3 className="mt-1 font-display text-base font-semibold">{t(std.titleKey as never)}</h3>
                </div>
                <Presentation className="size-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                {std.sections.map((id) => t(`reports.sec.${id}` as never)).join(" · ")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => exportPdf(report)}>
                  <Download className="size-3.5" />
                  PDF
                </Button>
                <Button size="sm" onClick={() => void openSend(report)}>
                  <Mail className="size-3.5" />
                  {t("reports.email")}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="gap-4 p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("reports.custom")}
          </p>
          <h3 className="mt-1 font-display text-base font-semibold">{t("reports.customTitle")}</h3>
        </div>
        {canCreate ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <div className="grid gap-2 sm:grid-cols-2">
              {REPORT_SECTIONS.map((sec) => (
                <label key={sec.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Checkbox
                    checked={picked.includes(sec.id)}
                    onCheckedChange={(on) =>
                      setPicked((prev) => (on ? [...prev, sec.id] : prev.filter((id) => id !== sec.id)))
                    }
                  />
                  {t(sec.labelKey as never)}
                </label>
              ))}
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("reports.customName")}</Label>
                <Input value={customName} onChange={(e) => setCustomName(e.target.value)} />
              </div>
              <Button
                className="w-full"
                disabled={saving || picked.length === 0 || !customName.trim()}
                onClick={() => {
                  setSaving(true);
                  void onSaveCustom(customName.trim(), picked).finally(() => {
                    setCustomName("");
                    setSaving(false);
                  });
                }}
              >
                <Plus className="size-4" />
                {t("reports.saveCustom")}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                disabled={picked.length === 0}
                onClick={() => exportPdf(make(customName.trim() || t("reports.untitled"), picked))}
              >
                <Download className="size-3.5" />
                {t("reports.previewPdf")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("reports.noCreate")}</p>
        )}

        {parsedSaved.length === 0 ? (
          <EmptyState
            icon={<Presentation className="size-5" />}
            title={t("reports.emptyCustom")}
            description={t("reports.emptyCustomDesc")}
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {parsedSaved.map((row) => {
              const report = make(row.name, row.ids);
              return (
                <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.ids.map((id) => t(`reports.sec.${id}` as never)).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => exportPdf(report)}>
                      <Download className="size-3.5" />
                      PDF
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void openSend(report)}>
                      <Mail className="size-3.5" />
                      {t("reports.email")}
                    </Button>
                    {canCreate ? (
                      <Button size="sm" variant="ghost" onClick={() => void onDeleteCustom(row.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ComposeEmailDialog
        open={Boolean(compose)}
        draft={compose?.draft ?? null}
        sending={busy}
        onCancel={() => setCompose(null)}
        onChange={(draft) => setCompose((cur) => (cur ? { ...cur, draft } : cur))}
        onSend={() => {
          void getSmtpSettings().then((smtp) => sendComposed(smtp));
        }}
      />
    </div>
  );
}
