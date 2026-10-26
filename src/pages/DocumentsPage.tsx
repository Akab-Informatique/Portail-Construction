import { Construction } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

/** Client › Documentation — reset; the new structure will be built here. */
export function DocumentsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("nav.documents")} />
      <EmptyState
        icon={<Construction className="size-5" />}
        title={t("rebuild.title")}
        description={t("rebuild.desc")}
      />
    </div>
  );
}
