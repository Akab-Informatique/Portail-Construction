import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Building2, HardHat } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { AccessGuide } from "@/components/admin/AccessGuide";
import { Button } from "@/components/ui/button";
import { AdminAccessPage } from "@/pages/admin/AdminAccessPage";
import { cn } from "@/lib/utils";

type Tab = "staff" | "clients";

/**
 * Administration › Access. Two tabs in a steel-and-hazard-stripe bar: Staff first, then Clients. Staff holds the people, their
 * profile and everything they can reach, and the groups; Clients holds the companies and their users, and their rights.
 */
export function AdminHubPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [guide, setGuide] = useState(false);

  // Older links used ?section=staff|staffRights|clients|clientRights.
  const legacy = params.get("section");
  const rawTab = params.get("tab") ?? (legacy === "staff" || legacy === "staffRights" ? "staff" : legacy === "clients" || legacy === "clientRights" ? "clients" : null);
  const tab: Tab = rawTab === "clients" ? "clients" : "staff";

  function go(next: Tab) {
    setParams({ tab: next }, { replace: true });
  }

  const tabs = [
    { id: "staff" as const, label: t("adm.hub.staff"), icon: HardHat },
    { id: "clients" as const, label: t("adm.hub.clients"), icon: Building2 },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.hub.title")}
        description={t("adm.hub.desc")}
        actions={
          <Button variant="outline" onClick={() => setGuide(true)}>
            <BookOpen className="size-4" />
            {t("adm.guide.button")}
          </Button>
        }
      />

      <nav className="frx-steel mb-6" aria-label={t("adm.hub.title")}>
        <div className="flex gap-1 overflow-x-auto px-3 pt-3">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn("frx-plate flex shrink-0 items-center gap-2.5 px-7 py-3 font-display text-xl uppercase tracking-[0.12em]", tab === id ? "frx-plate-on" : "frx-plate-off")}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
        <div className="frx-hazard h-2.5" aria-hidden />
      </nav>

      {tab === "staff" ? <AdminAccessPage key="staff" audience="internal" embedded /> : null}

      {tab === "clients" ? <AdminAccessPage key="clients" audience="external" embedded /> : null}
      <AccessGuide open={guide} onOpenChange={setGuide} />
    </div>
  );
}
