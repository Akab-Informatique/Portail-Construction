import type { ReactNode } from "react";
import { ClipboardClock, Receipt, Timer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { canUseMenuModule } from "@/lib/app-modules";
import { PageHeader } from "@/components/PageHeader";
import { RequireModule } from "@/components/RequireModule";
import { SiteTabs, type SiteTab } from "@/components/SiteTabs";
import type { ModuleId } from "@/lib/types";

/** Timesheets, expenses and punch live together under one menu entry, as tabs. Timesheets come first. */
export function TimeOnSitePage({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const tabs: (SiteTab & { module: ModuleId })[] = [
    { to: "/tools/timesheets", label: t("nav.timesheets"), icon: ClipboardClock, module: "app_timesheets" as ModuleId },
    { to: "/tools/expenses", label: t("nav.expenses"), icon: Receipt, module: "app_expenses" as ModuleId },
    { to: "/tools/punch", label: t("nav.punch"), icon: Timer, module: "app_punch" as ModuleId },
  ].filter((tab) => canUseMenuModule(user, can, tab.module));

  return (
    <div>
      <PageHeader eyebrow={t("nav.section.client")} title={t("nav.timeOnSite")} />
      {tabs.length > 1 ? <SiteTabs tabs={tabs} /> : null}
      <RequireModule module={module}>{children}</RequireModule>
    </div>
  );
}
