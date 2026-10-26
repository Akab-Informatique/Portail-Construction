import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/PageHeader";
import { SharePointLibrary } from "@/components/project/SharePointLibrary";
import { ShareAccessBoard } from "@/components/project/ShareAccessBoard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Chantier › Documentation: the company's SharePoint library. */
export function DocumentsPage() {
  const { t } = useI18n();
  const { can, user } = useAuth();
  const { selectedClient, projects } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "access" ? "access" : "library";
  const asClient = user?.user_type === "external" || user?.view_as === "client";
  const canManage = Boolean(user?.is_admin || user?.user_type === "internal") && !asClient;
  // There is no "active client" any more: staff see the whole library, while a
  // client account is limited to the folders shared with its own company.
  const forClient = asClient ? selectedClient : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("nav.section.client")} title={t("nav.documents")} />
      {canManage ? (
        <Tabs
          value={tab}
          onValueChange={(next) => setParams(next === "access" ? { tab: "access" } : {}, { replace: true })}
        >
          <TabsList>
            <TabsTrigger value="library">{t("nav.documents")}</TabsTrigger>
            <TabsTrigger value="access">{t("sp.manageAccess")}</TabsTrigger>
          </TabsList>
          <TabsContent value="library">
            <SharePointLibrary
              projectId={0}
              projectName={t("nav.documents")}
              client={null}
              canCreate={can("documents", "create")}
              scopeProjectIds={projects.map((p) => p.id)}
            />
          </TabsContent>
          <TabsContent value="access">
            <ShareAccessBoard />
          </TabsContent>
        </Tabs>
      ) : (
        <SharePointLibrary
          projectId={0}
          projectName={t("nav.documents")}
          client={forClient}
          canCreate={can("documents", "create")}
        />
      )}
    </div>
  );
}
