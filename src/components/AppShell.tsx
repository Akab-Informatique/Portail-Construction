import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  Eye,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Presentation,
  Receipt,
  Moon,
  Shield,
  Settings,
  Sun,
  Timer,
  Users,
  Wrench,
} from "lucide-react";
import { Logo } from "./Logo";
import { UserAvatar } from "./UserAvatar";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { ScrollArea } from "./ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { isProjectSection, PROJECT_NAV_GROUPS, projectSectionPath } from "@/lib/project-nav";
import { visibleProjectModules } from "@/lib/permissions";
import { NAV_SECTIONS_KEY } from "@/lib/constants";
import { ForcePasswordDialog } from "@/components/ForcePasswordDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageSkeleton } from "@/components/Skeleton";
import { MenuTour } from "@/components/MenuTour";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/en";
import type { ModuleId, ViewAsMode } from "@/lib/types";

type NavSectionId = "accounting" | "operations" | "tools";

const DEFAULT_NAV_SECTIONS: Record<NavSectionId, boolean> = {
  accounting: true,
  operations: true,
  tools: true,
};

function readNavSections(): Record<NavSectionId, boolean> {
  if (typeof window === "undefined") return DEFAULT_NAV_SECTIONS;
  try {
    const raw = localStorage.getItem(NAV_SECTIONS_KEY);
    if (!raw) return DEFAULT_NAV_SECTIONS;
    const parsed = JSON.parse(raw) as Partial<Record<NavSectionId, boolean>> & { configuration?: boolean };
    return {
      accounting: parsed.accounting ?? true,
      operations: parsed.operations ?? true,
      tools: parsed.tools ?? parsed.configuration ?? true,
    };
  } catch {
    return DEFAULT_NAV_SECTIONS;
  }
}

const CRUMB: Record<string, MessageKey> = {
  clients: "nav.clients",
  projects: "nav.projects",
  team: "nav.people",
  profile: "nav.profile",
  billing: "nav.billing",
  accounting: "nav.accounting",
  settings: "nav.setup",
  punch: "nav.punch",
  timesheets: "nav.timesheets",
  tools: "nav.tools",
  documents: "nav.documents",
  reports: "nav.reports",
};

function linkClass(isActive: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
  );
}

function NavSection({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: NavSectionId;
  label: string;
  open: boolean;
  onToggle: (id: NavSectionId) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`nav-section-${id}`}
        aria-label={t(open ? "nav.section.collapse" : "nav.section.expand", { section: label })}
        data-tour={id}
        className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/70"
      >
        <span>{label}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 opacity-70 transition-transform duration-150", open ? "rotate-0" : "-rotate-90")}
        />
      </button>
      {open && (
        <div id={`nav-section-${id}`} className="mt-0.5">
          {children}
        </div>
      )}
    </div>
  );
}

function useNavSections() {
  const location = useLocation();
  const [sections, setSections] = useState<Record<NavSectionId, boolean>>(readNavSections);

  useEffect(() => {
    const path = location.pathname;
    setSections((prev) => {
      const next = { ...prev };
      if (path.startsWith("/accounting")) next.accounting = true;
      if (path.startsWith("/clients") || path.startsWith("/projects")) next.operations = true;
      if (path.startsWith("/tools")) next.tools = true;
      return next;
    });
  }, [location.pathname]);

  function toggleSection(id: NavSectionId) {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(NAV_SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { sections, toggleSection };
}

function OperationsLinks({
  onNavigate,
  overviewLabel,
  showBilling = false,
}: {
  onNavigate?: () => void;
  overviewLabel: string;
  showBilling?: boolean;
}) {
  const { t } = useI18n();
  const { selectedClient, clientProjects } = useWorkspace();
  if (!selectedClient) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <NavLink
        to={`/clients/${selectedClient.id}`}
        end
        onClick={onNavigate}
        className={({ isActive }) => linkClass(isActive)}
      >
        <Building2 className="size-4 shrink-0 opacity-80" />
        {overviewLabel}
      </NavLink>
      <NavLink
        to="/documents"
        end
        onClick={onNavigate}
        className={({ isActive }) => linkClass(isActive)}
      >
        <FileText className="size-4 shrink-0 opacity-80" />
        {t("nav.clientDocuments")}
      </NavLink>
      <NavLink
        to="/projects"
        end
        onClick={onNavigate}
        className={({ isActive }) => linkClass(isActive)}
      >
        <FolderKanban className="size-4 shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 truncate">{t("nav.projects")}</span>
        <span className="tabular-nums text-[11px] text-sidebar-foreground/50">{clientProjects.length}</span>
      </NavLink>
      {showBilling ? (
        <NavLink
          to={`/clients/${selectedClient.id}/billing`}
          onClick={onNavigate}
          className={({ isActive }) => linkClass(isActive)}
        >
          <Receipt className="size-4 shrink-0 opacity-80" />
          {t("nav.billing")}
        </NavLink>
      ) : null}
    </div>
  );
}

function ClientPicker({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { clients, selectedClientId, selectClient } = useWorkspace();

  return (
    <div className="px-0.5 pb-2">
      <Select
        value={selectedClientId ? String(selectedClientId) : ""}
        onValueChange={(v) => {
          const id = Number(v);
          selectClient(id);
          navigate(`/clients/${id}`);
          onNavigate?.();
        }}
      >
        <SelectTrigger
          size="sm"
          className="h-9 w-full border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground shadow-none hover:bg-sidebar-accent/70 dark:bg-sidebar-accent/40"
        >
          <SelectValue placeholder={t("nav.selectClient")} />
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.company_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function hasGroupBilling(permissions: { module: string; can_view: number }[]) {
  return permissions.some((p) => p.module === "billing" && Number(p.can_view) === 1);
}

function StaffNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { user, can, permissions } = useAuth();
  const { sections, toggleSection } = useNavSections();
  const canSeeBilling = Boolean(user?.is_admin || can("billing", "view"));
  const canSeeAccounting = Boolean(user?.is_admin || hasGroupBilling(permissions));

  return (
    <nav className="flex flex-col px-2">
      <NavLink to="/" end onClick={onNavigate} data-tour="dashboard" className={({ isActive }) => linkClass(isActive)}>
        <LayoutDashboard className="size-4 shrink-0 opacity-80" />
        {t("nav.dashboard")}
      </NavLink>
      <NavLink to="/documents" end onClick={onNavigate} data-tour="documents" className={({ isActive }) => linkClass(isActive)}>
        <FileText className="size-4 shrink-0 opacity-80" />
        {t("nav.documents")}
      </NavLink>
      <NavLink to="/documents/projects" onClick={onNavigate} data-tour="projectsDocs" className={({ isActive }) => linkClass(isActive)}>
        <FolderKanban className="size-4 shrink-0 opacity-80" />
        {t("sp.tab.projects")}
      </NavLink>
      {user?.is_admin && user.view_as !== "client" ? (
        <NavLink to="/reports" end onClick={onNavigate} data-tour="reports" className={({ isActive }) => linkClass(isActive)}>
          <Presentation className="size-4 shrink-0 opacity-80" />
          {t("nav.reports")}
        </NavLink>
      ) : null}

      <NavSection
        id="operations"
        label={t("nav.operations")}
        open={sections.operations}
        onToggle={toggleSection}
      >
        <ClientPicker onNavigate={onNavigate} />
        <OperationsLinks
          onNavigate={onNavigate}
          overviewLabel={t("nav.clientDashboard")}
          showBilling={canSeeBilling}
        />
      </NavSection>

      <NavSection id="tools" label={t("nav.tools")} open={sections.tools} onToggle={toggleSection}>
        <NavLink to="/tools/punch" onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
          <Timer className="size-4 shrink-0 opacity-80" />
          {t("nav.punch")}
        </NavLink>
        <NavLink to="/tools/timesheets" onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
          <Wrench className="size-4 shrink-0 opacity-80" />
          {t("nav.timesheets")}
        </NavLink>
      </NavSection>

      {canSeeAccounting ? (
        <NavSection
          id="accounting"
          label={t("nav.accounting")}
          open={sections.accounting}
          onToggle={toggleSection}
        >
          <NavLink to="/accounting/billing" onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
            <Receipt className="size-4 shrink-0 opacity-80" />
            {t("nav.billing")}
          </NavLink>
        </NavSection>
      ) : null}
    </nav>
  );
}

function ProjectMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, permissions } = useAuth();
  const { activeProject } = useWorkspace();
  if (!activeProject) return null;

  const allowed = visibleProjectModules(user, permissions, activeProject.id);
  const parts = location.pathname.split("/").filter(Boolean);
  const current: ModuleId = isProjectSection(parts[2]) ? parts[2] : "dashboard";

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      <button
        type="button"
        onClick={() => {
          navigate(`/clients/${activeProject.client_id}`);
          onNavigate?.();
        }}
        className={linkClass(false)}
      >
        <ArrowLeft className="size-4 shrink-0 opacity-80" />
        {t("nav.backToMenu")}
      </button>
      <p className="mb-1 mt-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
        {activeProject.project_number}
      </p>
      <p className="mb-2 truncate px-2.5 text-sm font-medium text-sidebar-foreground">{activeProject.name}</p>
      {PROJECT_NAV_GROUPS.map((group) => {
        const items = group.items.filter((n) => allowed.includes(n.id));
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="mb-2">
            <p className="mb-1 mt-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
              {t(group.labelKey)}
            </p>
            {items.map((n) => {
              const to = projectSectionPath(activeProject.id, n.id);
              const active = current === n.id;
              return (
                <NavLink key={n.id} to={to} onClick={onNavigate} className={linkClass(active)} end={n.id === "dashboard"}>
                  <n.icon className="size-4 shrink-0 opacity-80" />
                  {t(n.labelKey)}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function ClientNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { viewAs } = useAuth();
  const { clients, selectedClient } = useWorkspace();
  const { sections, toggleSection } = useNavSections();
  const impersonating = viewAs === "client";

  return (
    <nav className="flex flex-col px-2">
      <NavLink to="/" end onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
        <LayoutDashboard className="size-4 shrink-0 opacity-80" />
        {t("nav.dashboard")}
      </NavLink>

      <NavSection
        id="operations"
        label={t("nav.operations")}
        open={sections.operations}
        onToggle={toggleSection}
      >
        {impersonating && selectedClient ? (
          <p className="mb-1.5 truncate px-2.5 text-[11px] text-sidebar-foreground/50">
            {selectedClient.company_name}
          </p>
        ) : clients.length > 1 ? (
          <ClientPicker onNavigate={onNavigate} />
        ) : selectedClient ? (
          <p className="mb-1.5 truncate px-2.5 text-[11px] text-sidebar-foreground/50">
            {selectedClient.company_name}
          </p>
        ) : (
          <p className="mb-1.5 px-2.5 text-[11px] text-sidebar-foreground/50">{t("nav.yourCompany")}</p>
        )}
        <OperationsLinks onNavigate={onNavigate} overviewLabel={t("nav.companyOverview")} showBilling />
      </NavSection>
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, realUser, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectMode } = useWorkspace();
  const isAdmin = Boolean(realUser?.is_admin);
  const isClient = user?.user_type === "external";
  const onSetup = location.pathname.startsWith("/settings") || location.pathname.startsWith("/config/settings");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <Logo inverted wordmark />
      </div>
      <ScrollArea className="flex-1 py-2">
        {projectMode ? (
          <ProjectMenu onNavigate={onNavigate} />
        ) : isClient ? (
          <ClientNav onNavigate={onNavigate} />
        ) : (
          <StaffNav onNavigate={onNavigate} />
        )}
      </ScrollArea>
      <div className="p-3">
        <Separator className="mb-3 bg-sidebar-border" />
        {isAdmin ? (
          <div className="mb-1 flex justify-end px-1.5">
            <Button
              size="icon-sm"
              variant="ghost"
              className={cn(
                "size-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                onSetup && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              onClick={() => {
                onNavigate?.();
                navigate("/settings");
              }}
              aria-label={t("nav.setup")}
              title={t("nav.setup")}
            >
              <Settings className="size-3.5" />
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-1 rounded-lg px-1.5 py-1">
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              navigate("/profile");
            }}
            data-tour="profile"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-sidebar-accent/70"
            aria-label={t("nav.profile")}
          >
            <UserAvatar name={user?.name ?? "?"} hint={user?.avatar_initials} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.name}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/55">
                {user?.is_admin ? t("role.administrator") : user?.title || user?.user_type}
              </p>
            </div>
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            aria-label={t("nav.signOut")}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const { theme, toggle } = useTheme();
  const { realUser, viewAs, setViewAs, updateProfile } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProject, selectedClientId } = useWorkspace();
  const [open, setOpen] = useState(false);

  function chooseView(mode: ViewAsMode) {
    setViewAs(mode);
    if (mode === "client") {
      if (selectedClientId) navigate(`/clients/${selectedClientId}`);
      else navigate("/");
      return;
    }
    if (mode !== "admin" && (location.pathname.startsWith("/settings") || location.pathname.startsWith("/accounting"))) {
      navigate("/");
    }
  }

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const crumbs = location.pathname
    .split("/")
    .filter(Boolean)
    .filter((s) => Number.isNaN(Number(s)));
  const lastCrumb = crumbs[crumbs.length - 1];
  const crumbKey = (lastCrumb && CRUMB[lastCrumb]) || (crumbs[0] ? CRUMB[crumbs[0]] : "nav.dashboard");
  const crumbLabel = activeProject && crumbs[0] === "projects" ? activeProject.name : t(crumbKey ?? "nav.dashboard");

  return (
    <div className="flex min-h-screen bg-background">
      <ForcePasswordDialog />
      <MenuTour />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
        <div className="h-1 w-full bg-primary" />
        <SidebarBody />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t("nav.openMenu")}>
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-60 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground"
            >
              <SidebarBody onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
            <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-foreground">FRX</span>
            {crumbs.length > 0 && <ChevronLeft className="size-3 rotate-180 opacity-50" />}
            <span className="truncate">{crumbLabel}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {realUser?.is_admin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
                  >
                    {viewAs === "staff" ? (
                      <Users className="size-3" />
                    ) : viewAs === "client" ? (
                      <Eye className="size-3" />
                    ) : (
                      <Shield className="size-3" />
                    )}
                    {viewAs === "staff" ? t("viewAs.staff") : viewAs === "client" ? t("viewAs.client") : t("nav.admin")}
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{t("viewAs.title")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => chooseView("admin")}>
                    <Shield className="size-3.5" />
                    {t("viewAs.admin")}
                    {viewAs === "admin" ? <Check className="ml-auto size-3.5" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => chooseView("staff")}>
                    <Users className="size-3.5" />
                    {t("viewAs.staff")}
                    {viewAs === "staff" ? <Check className="ml-auto size-3.5" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => chooseView("client")}>
                    <Eye className="size-3.5" />
                    {t("viewAs.client")}
                    {viewAs === "client" ? <Check className="ml-auto size-3.5" /> : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <div className="flex items-center overflow-hidden rounded-sm border border-primary/40">
              {(["en", "fr"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setLocale(code);
                    void updateProfile({ locale: code });
                  }}
                  className={cn(
                    "min-w-10 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]",
                    locale === code
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {code}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                toggle();
                void updateProfile({ theme: next });
              }}
              aria-label={t("nav.toggleTheme")}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className={cn("mx-auto", location.pathname === "/projects" ? "max-w-none" : "max-w-6xl")}>
            {/* Keyed by path so a crash on one page clears when the user navigates away. */}
            <ErrorBoundary key={location.pathname} inline>
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
