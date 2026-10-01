import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { PageSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth";
import { WorkspaceProvider } from "@/lib/workspace";
import { LoginPage } from "@/pages/LoginPage";
import { lazyPage } from "@/lib/lazy-page";

const DashboardPage = lazyPage(() => import("@/pages/DashboardPage"), "DashboardPage");
const ClientsPage = lazyPage(() => import("@/pages/ClientsPage"), "ClientsPage");
const ClientDetailPage = lazyPage(() => import("@/pages/ClientDetailPage"), "ClientDetailPage");
const ProjectsPage = lazyPage(() => import("@/pages/ProjectsPage"), "ProjectsPage");
const ProjectDetailPage = lazyPage(() => import("@/pages/ProjectDetailPage"), "ProjectDetailPage");
const TeamPage = lazyPage(() => import("@/pages/TeamPage"), "TeamPage");
const UserAccessPage = lazyPage(() => import("@/pages/UserAccessPage"), "UserAccessPage");
const ProfilePage = lazyPage(() => import("@/pages/ProfilePage"), "ProfilePage");
const ConfigUserPage = lazyPage(() => import("@/pages/config/ConfigUserPage"), "ConfigUserPage");
const ClientBillingPage = lazyPage(() => import("@/pages/ClientBillingPage"), "ClientBillingPage");
const AccountingBillingPage = lazyPage(() => import("@/pages/AccountingBillingPage"), "AccountingBillingPage");
const ConfigSettingsPage = lazyPage(() => import("@/pages/config/ConfigSettingsPage"), "ConfigSettingsPage");
const PunchPage = lazyPage(() => import("@/pages/PunchPage"), "PunchPage");
const TimesheetsPage = lazyPage(() => import("@/pages/TimesheetsPage"), "TimesheetsPage");
const DocumentsPage = lazyPage(() => import("@/pages/DocumentsPage"), "DocumentsPage");
const DocumentsProjectsPage = lazyPage(() => import("@/pages/DocumentsProjectsPage"), "DocumentsProjectsPage");
const ReportsPage = lazyPage(() => import("@/pages/ReportsPage"), "ReportsPage");

function ProtectedLayout() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="w-full max-w-4xl">
          <PageSkeleton />
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route
          element={
            <WorkspaceProvider>
              <AppShell />
            </WorkspaceProvider>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="documents/projects" element={<DocumentsProjectsPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:clientId" element={<ClientDetailPage />} />
          <Route path="clients/:clientId/billing" element={<ClientBillingPage />} />
          <Route path="accounting/billing" element={<AccountingBillingPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="projects/:projectId/:section" element={<ProjectDetailPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="team/:userId" element={<UserAccessPage />} />
          <Route path="config/clients" element={<Navigate to="/settings?tab=clients" replace />} />
          <Route path="config/internal" element={<Navigate to="/settings?tab=users" replace />} />
          <Route path="config/groups" element={<Navigate to="/settings?tab=users" replace />} />
          <Route path="config/users/:userId" element={<ConfigUserPage />} />
          <Route path="config/settings" element={<Navigate to="/settings" replace />} />
          <Route path="settings" element={<ConfigSettingsPage />} />
          <Route path="tools/punch" element={<PunchPage />} />
          <Route path="tools/timesheets" element={<TimesheetsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
