import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Building2, HardHat, KeyRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { AccessGuide } from "@/components/admin/AccessGuide";
import { Button } from "@/components/ui/button";
import { ConfigClientsPage } from "@/pages/config/ConfigClientsPage";
import { AdminAccessPage } from "@/pages/admin/AdminAccessPage";
import { cn } from "@/lib/utils";

type Tab = "staff" | "clients";
type Sub = "companies" | "rights";

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
  const sub: Sub = params.get("sub") === "rights" || legacy === "clientRights" ? "rights" : "companies";

  function go(next: Tab, nextSub?: Sub) {
    const out = new URLSearchParams();
    out.set("tab", next);
    if (next === "clients" && nextSub === "rights") out.set("sub", "rights");
    setParams(out, { replace: true });
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

      {tab === "clients" ? (
        <div className="grid gap-5">
          <div className="inline-flex w-fit rounded-lg border bg-muted/40 p-0.5">
            {(
              [
                ["companies", t("adm.sub.companies"), Building2],
                ["rights", t("adm.sub.rights"), KeyRound],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => go("clients", id)} aria-pressed={sub === id} className={cn("flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors", sub === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
          {sub === "companies" ? <ConfigClientsPage embedded /> : <AdminAccessPage key="clients" audience="external" embedded />}
        </div>
      ) : null}
      <AccessGuide open={guide} onOpenChange={setGuide} />
    </div>
  );
}
