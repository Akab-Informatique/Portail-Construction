import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { canUseMenuModule } from "@/lib/app-modules";
import type { ModuleId } from "@/lib/types";

/** Opens a page only to staff whose rights include its sidebar module. Administrators and client accounts pass. */
export function RequireModule({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { user, can } = useAuth();
  const { t } = useI18n();
  if (canUseMenuModule(user, can, module)) return <>{children}</>;
  return <EmptyState icon={<Lock className="size-5" />} title={t("module.noAccess")} description={t("module.noAccess.desc")} />;
}
