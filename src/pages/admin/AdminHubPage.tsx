import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Building2, HardHat, KeyRound, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/en";
import { PageHeader } from "@/components/PageHeader";
import { AccessGuide } from "@/components/admin/AccessGuide";
import { Button } from "@/components/ui/button";
import { ConfigClientsPage } from "@/pages/config/ConfigClientsPage";
import { ConfigInternalUsersPage } from "@/pages/config/ConfigInternalUsersPage";
import { AdminAccessPage } from "@/pages/admin/AdminAccessPage";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "clients", label: "adm.hub.clients", icon: Building2 },
  { id: "staff", label: "adm.hub.staff", icon: HardHat },
  { id: "clientRights", label: "adm.hub.clientRights", icon: KeyRound },
  { id: "staffRights", label: "adm.hub.staffRights", icon: ShieldCheck },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

/**
 * Administration › Access: one page with a banner of four sections. Clients and Staff are the people (create them and give
 * their first access); Client rights and Staff rights are where everything each person, company or group can reach is set.
 */
export function AdminHubPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [guide, setGuide] = useState(false);
  const requested = params.get("section");
  const section: Section = SECTIONS.some((s) => s.id === requested) ? (requested as Section) : "clients";

  function go(next: Section) {
    setParams({ section: next }, { replace: true });
  }

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
      <nav className="mb-6 flex w-full gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1 sm:w-fit" aria-label={t("adm.hub.title")}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            aria-current={section === id ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all",
              section === id ? "bg-card text-foreground shadow-sm shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4", section === id && "text-primary")} />
            {t(label as MessageKey)}
          </button>
        ))}
      </nav>

      {section === "clients" ? <ConfigClientsPage embedded /> : null}
      {section === "staff" ? <ConfigInternalUsersPage embedded /> : null}
      {section === "clientRights" ? <AdminAccessPage key="c" audience="external" embedded /> : null}
      {section === "staffRights" ? <AdminAccessPage key="s" audience="internal" embedded /> : null}
      <AccessGuide open={guide} onOpenChange={setGuide} />
    </div>
  );
}
