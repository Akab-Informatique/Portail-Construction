import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { PageSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth";
import { WorkspaceProvider } from "@/lib/workspace";
import { ClockProvider } from "@/lib/clock";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { lazyPage } from "@/lib/lazy-page";
// Small tab frame around the punch/timesheet pages (those stay lazy-loaded).
import { TimeOnSitePage } from "@/pages/TimeOnSitePage";
import { RequireModule } from "@/components/RequireModule";

const DashboardPage = lazyPage(() => import("@/pages/DashboardPage"), "DashboardPage");
const ClientsPage = lazyPage(() => import("@/pages/ClientsPage"), "ClientsPage");
const ProjectsPage = lazyPage(() => import("@/pages/ProjectsPage"), "ProjectsPage");
const ProjectDetailPage = lazyPage(() => import("@/pages/ProjectDetailPage"), "ProjectDetailPage");
const TeamPage = lazyPage(() => import("@/pages/TeamPage"), "TeamPage");
const UserAccessPage = lazyPage(() => import("@/pages/UserAccessPage"), "UserAccessPage");
const ProfilePage = lazyPage(() => import("@/pages/ProfilePage"), "ProfilePage");
const ConfigUserPage = lazyPage(() => import("@/pages/config/ConfigUserPage"), "ConfigUserPage");
const AccountingBillingPage = lazyPage(() => import("@/pages/AccountingBillingPage"), "AccountingBillingPage");
const ConfigSettingsPage = lazyPage(() => import("@/pages/config/ConfigSettingsPage"), "ConfigSettingsPage");
const PunchPage = lazyPage(() => import("@/pages/PunchPage"), "PunchPage");
const TimesheetsPage = lazyPage(() => import("@/pages/TimesheetsPage"), "TimesheetsPage");
const ExpensesPage = lazyPage(() => import("@/pages/ExpensesPage"), "ExpensesPage");
const DocumentsPage = lazyPage(() => import("@/pages/DocumentsPage"), "DocumentsPage");
const DocumentsProjectsPage = lazyPage(() => import("@/pages/DocumentsProjectsPage"), "DocumentsProjectsPage");
const ReportsPage = lazyPage(() => import("@/pages/ReportsPage"), "ReportsPage");
const FinanceBillingPage = lazyPage(() => import("@/pages/FinanceBillingPage"), "FinanceBillingPage");

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
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedLayout />}>
        <Route
          element={
            <WorkspaceProvider>
              <ClockProvider>
                <AppShell />
              </ClockProvider>
            </WorkspaceProvider>
          }
        >
          <Route index element={<RequireModule module="app_dashboard"><DashboardPage /></RequireModule>} />
          <Route path="documents" element={<RequireModule module="app_client_documents"><DocumentsPage /></RequireModule>} />
          <Route path="documents/projects" element={<RequireModule module="app_all_projects"><DocumentsProjectsPage /></RequireModule>} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="accounting/billing" element={<AccountingBillingPage />} />
          <Route path="finance/billing" element={<RequireModule module="app_billing_mgmt"><FinanceBillingPage /></RequireModule>} />
          <Route path="projects" element={<RequireModule module="app_client_projects"><ProjectsPage /></RequireModule>} />
          <Route path="reports" element={<RequireModule module="app_reports"><ReportsPage /></RequireModule>} />
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
          <Route path="tools/punch" element={<TimeOnSitePage module="app_punch"><PunchPage /></TimeOnSitePage>} />
          <Route path="tools/timesheets" element={<TimeOnSitePage module="app_timesheets"><TimesheetsPage /></TimeOnSitePage>} />
          <Route path="tools/expenses" element={<TimeOnSitePage module="app_expenses"><ExpensesPage /></TimeOnSitePage>} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
