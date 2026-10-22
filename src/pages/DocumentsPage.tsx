import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/PageHeader";
import { SharePointLibrary } from "@/components/project/SharePointLibrary";
import { ShareAccessBoard } from "@/components/project/ShareAccessBoard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function DocumentsPage() {
  const { t } = useI18n();
  const { can, user } = useAuth();
  const { selectedClient, clientProjects, projects } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "access" ? "access" : "library";
  const canManage = Boolean(user?.is_admin || user?.user_type === "internal") && user?.view_as !== "client";
  const forClient = selectedClient;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.documents")}
      />
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
              client={forClient}
              canCreate={can("documents", "create")}
              scopeProjectIds={(forClient ? clientProjects : projects).map((p) => p.id)}
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
