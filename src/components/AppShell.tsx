import { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Presentation,
  Receipt,
  Search,
  Settings,
  Shield,
  Sun,
  Timer,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { UserAvatar } from "./UserAvatar";
import { Button } from "./ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { CommandPalette, useCommandPaletteHotkey } from "./CommandPalette";
import { ClockBadge, SignOutGuard } from "./ClockBadge";
import { useClock } from "@/lib/clock";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { PROJECT_NAV_GROUPS, projectSectionPath } from "@/lib/project-nav";
import { visibleProjectModules } from "@/lib/permissions";
import { ForcePasswordDialog } from "@/components/ForcePasswordDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageSkeleton } from "@/components/Skeleton";
import { MenuTour } from "@/components/MenuTour";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/en";
import type { ViewAsMode } from "@/lib/types";

const COLLAPSED_KEY = "frx.sidebar.collapsed";

export type NavItem = {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  count?: number;
  tour?: string;
};

export type NavSection = {
  id: string;
  label: string;
  /** Shown next to the section label, e.g. the selected client's name. */
  context?: string;
  tour?: string;
  items: NavItem[];
  /** Rendered between the label and the items (client switcher). */
  lead?: "clientPicker" | "clientName";
};

function hasGroupBilling(permissions: { module: string; can_view: number }[]) {
  return permissions.some((p) => p.module === "billing" && Number(p.can_view) === 1);
}

/**
 * The main menu, ordered the way work flows: overview → the client you are
 * working on → field time → money. Shared by the sidebar and the Ctrl+K palette.
 */
export function useNavModel(): NavSection[] {
  const { t } = useI18n();
  const { user, can, permissions } = useAuth();
  const { selectedClient, clientProjects, clients } = useWorkspace();

  return useMemo(() => {
    const isClient = user?.user_type === "external";
    const isAdmin = Boolean(user?.is_admin) && user?.view_as !== "client";
    const clientItems: NavItem[] = selectedClient
      ? [
          {
            id: "clientOverview",
            to: `/clients/${selectedClient.id}`,
            label: isClient ? t("nav.companyOverview") : t("nav.clientOverview"),
            icon: Building2,
            end: true,
          },
          {
            id: "clientProjects",
            to: "/projects",
            label: t("nav.projects"),
            icon: FolderKanban,
            end: true,
            count: clientProjects.length,
          },
          { id: "clientDocuments", to: "/documents", label: t("nav.documents"), icon: FileText, end: true, tour: "documents" },
          ...(isClient || isAdmin || can("billing", "view")
            ? [{ id: "clientBilling", to: `/clients/${selectedClient.id}/billing`, label: t("nav.billing"), icon: Receipt }]
            : []),
        ]
      : [];

    if (isClient) {
      return [
        {
          id: "overview",
          label: t("nav.section.overview"),
          items: [{ id: "dashboard", to: "/", label: t("nav.dashboard"), icon: LayoutDashboard, end: true, tour: "dashboard" }],
        },
        {
          id: "client",
          label: t("nav.yourCompany"),
          tour: "operations",
          lead: clients.length > 1 && user?.view_as !== "client" ? "clientPicker" : "clientName",
          context: selectedClient?.company_name,
          items: clientItems,
        },
      ];
    }

    const sections: NavSection[] = [
      {
        id: "overview",
        label: t("nav.section.overview"),
        items: [
          { id: "dashboard", to: "/", label: t("nav.dashboard"), icon: LayoutDashboard, end: true, tour: "dashboard" },
          { id: "allProjects", to: "/documents/projects", label: t("nav.allProjects"), icon: LayoutGrid, tour: "projectsDocs" },
          ...(isAdmin ? [{ id: "reports", to: "/reports", label: t("nav.reports"), icon: Presentation, end: true, tour: "reports" }] : []),
        ],
      },
      {
        id: "client",
        label: t("nav.section.client"),
        tour: "operations",
        lead: "clientPicker",
        context: selectedClient?.company_name,
        items: clientItems,
      },
      {
        id: "field",
        label: t("nav.section.field"),
        tour: "tools",
        items: [
          { id: "punch", to: "/tools/punch", label: t("nav.punch"), icon: Timer },
          { id: "timesheets", to: "/tools/timesheets", label: t("nav.timesheets"), icon: Wrench },
        ],
      },
    ];
    if (isAdmin || hasGroupBilling(permissions)) {
      sections.push({
        id: "finance",
        label: t("nav.section.finance"),
        tour: "accounting",
        items: [{ id: "allBilling", to: "/accounting/billing", label: t("nav.allBilling"), icon: Wallet }],
      });
    }
    return sections;
  }, [t, user, can, permissions, selectedClient, clientProjects.length, clients.length]);
}

type SidebarCtx = { collapsed: boolean; onNavigate?: () => void };
const SidebarContext = createContext<SidebarCtx>({ collapsed: false });

function itemClass(active: boolean, collapsed: boolean) {
  return cn(
    "group relative flex h-9 items-center gap-3 rounded-sm text-[13.5px] transition-colors",
    collapsed ? "justify-center px-0" : "px-3",
    active
      ? "bg-white/[0.07] text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:bg-primary"
      : "text-white/60 hover:bg-white/[0.04] hover:text-white",
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const { collapsed, onNavigate } = useContext(SidebarContext);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      data-tour={item.tour}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) => itemClass(isActive, collapsed)}
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("size-[17px] shrink-0", isActive ? "text-primary" : "opacity-75 group-hover:opacity-100")} />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
          {!collapsed && item.count !== undefined ? (
            <span className="font-mono text-[11px] tabular-nums text-white/40">{String(item.count).padStart(2, "0")}</span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function ClientSwitcher() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { onNavigate } = useContext(SidebarContext);
  const { clients, selectedClient, selectedClientId, selectClient } = useWorkspace();

  return (
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
        aria-label={t("nav.workingOn")}
        className="frx-ticks mb-2 h-auto w-full rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left shadow-none hover:border-primary/60 hover:bg-white/[0.05] focus-visible:ring-primary/40 dark:bg-white/[0.03] dark:hover:bg-white/[0.05] [&>svg]:text-white/50"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary font-display text-sm font-bold text-black">
            {(selectedClient?.company_name ?? "?").slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="frx-label block text-[9px] text-white/45">{t("nav.workingOn")}</span>
            <span className="block truncate text-[13.5px] font-semibold text-white">
              {selectedClient?.company_name ?? t("nav.selectClient")}
            </span>
          </span>
        </span>
      </SelectTrigger>
      {/* "popper" anchors the list under the custom trigger; the default
          item-aligned mode needs a <SelectValue> and opened off-screen. */}
      <SelectContent position="popper" sideOffset={6} className="w-(--radix-select-trigger-width)">
        {clients.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.company_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SectionBlock({ section, index }: { section: NavSection; index: number }) {
  const { collapsed } = useContext(SidebarContext);
  const { t } = useI18n();
  return (
    <div className="mt-5 first:mt-1" data-tour={section.tour}>
      {collapsed ? (
        <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
      ) : (
        <p className="frx-label mb-2 flex items-center gap-2 px-3 text-white/35">
          <span className="text-primary">{String(index + 1).padStart(2, "0")}</span>
          <span>{section.label}</span>
          <span className="h-px flex-1 bg-white/[0.08]" aria-hidden />
        </p>
      )}
      {!collapsed && section.lead === "clientPicker" ? <ClientSwitcher /> : null}
      {!collapsed && section.lead === "clientName" && section.context ? (
        <p className="mb-2 truncate px-3 text-[12px] font-semibold text-white/70">{section.context}</p>
      ) : null}
      {section.items.length === 0 && !collapsed && section.lead !== "clientPicker" ? (
        <p className="px-3 py-1 text-[12px] text-white/35">{t("nav.selectClient")}</p>
      ) : null}
      <div className="flex flex-col gap-0.5">
        {section.items.map((item) => (
          <SidebarLink key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function ProjectMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { collapsed, onNavigate } = useContext(SidebarContext);
  const { user, permissions } = useAuth();
  const { activeProject } = useWorkspace();
  if (!activeProject) return null;

  const allowed = visibleProjectModules(user, permissions, activeProject.id);

  return (
    <nav className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          navigate(`/clients/${activeProject.client_id}`);
          onNavigate?.();
        }}
        title={collapsed ? t("nav.backToMenu") : undefined}
        className={itemClass(false, collapsed)}
      >
        <ArrowLeft className="size-[17px] shrink-0 opacity-75" />
        {!collapsed && t("nav.backToMenu")}
      </button>
      {!collapsed && (
        <div className="frx-ticks mx-0 mb-1 mt-3 border border-white/10 bg-white/[0.03] px-3 py-3">
          <p className="frx-label text-primary">{activeProject.project_number}</p>
          <p className="mt-1 truncate font-display text-lg font-bold leading-tight text-white">{activeProject.name}</p>
        </div>
      )}
      {PROJECT_NAV_GROUPS.map((group, gi) => {
        const items = group.items.filter((n) => allowed.includes(n.id));
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="mt-4">
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
            ) : (
              <p className="frx-label mb-2 flex items-center gap-2 px-3 text-white/35">
                <span className="text-primary">{String(gi + 1).padStart(2, "0")}</span>
                <span>{t(group.labelKey as MessageKey)}</span>
                <span className="h-px flex-1 bg-white/[0.08]" aria-hidden />
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {items.map((n) => (
                <SidebarLink
                  key={n.id}
                  item={{
                    id: n.id,
                    to: projectSectionPath(activeProject.id, n.id),
                    label: t(n.labelKey),
                    icon: n.icon,
                    end: n.id === "dashboard" ? true : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarBody({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
  onSearch,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSearch: () => void;
}) {
  const { user, realUser, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectMode } = useWorkspace();
  const sections = useNavModel();
  const clock = useClock();
  const [guardOpen, setGuardOpen] = useState(false);
  const isAdmin = Boolean(realUser?.is_admin) && user?.view_as !== "client";
  function signOut() {
    setGuardOpen(false);
    logout();
    navigate("/login");
  }
  const onSetup = location.pathname.startsWith("/settings") || location.pathname.startsWith("/config");

  return (
    <SidebarContext.Provider value={{ collapsed, onNavigate }}>
      <div className="flex h-full flex-col">
        <div className="frx-beam h-1 w-full shrink-0" aria-hidden />
        <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "justify-between px-4")}>
          <button
            type="button"
            onClick={() => {
              navigate("/");
              onNavigate?.();
            }}
            className="flex items-center gap-2.5"
            aria-label={t("nav.home")}
          >
            <img src="/brand/logo-icon.png" alt="" className="size-8 object-contain" />
            {!collapsed && (
              <span className="leading-none">
                <span className="block font-display text-[17px] font-bold tracking-[0.2em] text-white">FRX</span>
                <span className="mt-0.5 block font-display text-[9.5px] font-semibold tracking-[0.34em] text-primary">
                  {t("brand.construction")}
                </span>
              </span>
            )}
          </button>
          {onToggleCollapsed && !collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex size-7 items-center justify-center rounded-sm text-white/40 hover:bg-white/[0.06] hover:text-white"
              aria-label={t("nav.collapseSidebar")}
              title={t("nav.collapseSidebar")}
            >
              <ChevronsLeft className="size-4" />
            </button>
          ) : null}
        </div>

        <div className={cn("pb-2", collapsed ? "px-2" : "px-3")}>
          <button
            type="button"
            onClick={onSearch}
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-sm border border-white/10 bg-white/[0.03] text-[13px] text-white/50 transition-colors hover:border-white/25 hover:text-white",
              collapsed ? "justify-center" : "px-3",
            )}
            aria-label={t("nav.search")}
            title={collapsed ? t("nav.search") : undefined}
          >
            <Search className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{t("nav.search")}</span>
                <kbd className="frx-label rounded-[3px] border border-white/15 px-1.5 py-0.5 text-[9px] text-white/50">
                  Ctrl K
                </kbd>
              </>
            )}
          </button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className={cn("pb-4 pt-2", collapsed ? "px-2" : "px-3")}>
            {projectMode ? (
              <ProjectMenu />
            ) : (
              <nav className="flex flex-col">
                {sections.map((section, i) => (
                  <SectionBlock key={section.id} section={section} index={i} />
                ))}
              </nav>
            )}
          </div>
        </ScrollArea>

        <div className={cn("shrink-0 border-t border-white/[0.08] py-3", collapsed ? "px-2" : "px-3")}>
          {collapsed && onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={itemClass(false, true)}
              aria-label={t("nav.expandSidebar")}
              title={t("nav.expandSidebar")}
            >
              <ChevronsRight className="size-[17px]" />
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              data-tour="setup"
              onClick={() => {
                onNavigate?.();
                navigate("/settings");
              }}
              title={collapsed ? t("nav.setup") : undefined}
              aria-label={collapsed ? t("nav.setup") : undefined}
              className={cn(itemClass(onSetup, collapsed), "w-full")}
            >
              <Settings className={cn("size-[17px] shrink-0", onSetup ? "text-primary" : "opacity-75")} />
              {!collapsed && t("nav.setup")}
            </button>
          ) : null}
          <div className={cn("mt-2 flex items-center gap-1", collapsed && "flex-col")}>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                navigate("/profile");
              }}
              data-tour="profile"
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-sm p-1.5 text-left transition-colors hover:bg-white/[0.05]",
                collapsed ? "justify-center" : "flex-1",
              )}
              aria-label={t("nav.profile")}
              title={collapsed ? user?.name : undefined}
            >
              <UserAvatar name={user?.name ?? "?"} hint={user?.avatar_initials} size="sm" />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white">{user?.name}</span>
                  <span className="frx-label block truncate text-[9px] text-white/45">
                    {user?.is_admin ? t("role.administrator") : user?.title || user?.user_type}
                  </span>
                </span>
              )}
            </button>
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-sm text-white/50 hover:bg-white/[0.06] hover:text-primary"
              onClick={() => (clock.open ? setGuardOpen(true) : signOut())}
              aria-label={t("nav.signOut")}
              title={t("nav.signOut")}
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <SignOutGuard
        open={guardOpen}
        onOpenChange={setGuardOpen}
        onConfirm={() => {
          onNavigate?.();
          signOut();
        }}
      />
    </SidebarContext.Provider>
  );
}

const CRUMB: Record<string, MessageKey> = {
  clients: "nav.clients",
  projects: "nav.projects",
  team: "nav.people",
  profile: "nav.profile",
  billing: "nav.billing",
  accounting: "nav.allBilling",
  settings: "nav.setup",
  punch: "nav.punch",
  timesheets: "nav.timesheets",
  tools: "nav.section.field",
  documents: "nav.documents",
  reports: "nav.reports",
};

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const { theme, toggle } = useTheme();
  const { realUser, viewAs, setViewAs, updateProfile } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProject, selectedClient, selectedClientId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  useCommandPaletteHotkey(() => setSearchOpen(true));

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

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

  const segments = location.pathname.split("/").filter(Boolean);
  const named = segments.filter((s) => Number.isNaN(Number(s)));
  const last = named[named.length - 1];
  const pageKey = (last && CRUMB[last]) || (named[0] ? CRUMB[named[0]] : undefined) || "nav.dashboard";
  const onClientHome = named.length === 1 && named[0] === "clients" && segments.length === 2;
  const pageLabel =
    activeProject && named[0] === "projects"
      ? activeProject.name
      : onClientHome
        ? t("nav.clientOverview")
        : t(pageKey);
  const showClientCrumb =
    selectedClient &&
    (named[0] === "clients" || named[0] === "projects" || (named[0] === "documents" && named.length === 1));

  return (
    <div className="flex min-h-screen bg-background">
      <ForcePasswordDialog />
      <MenuTour />
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-white/[0.07] bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:block",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <SidebarBody collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onSearch={() => setSearchOpen(true)} />
      </aside>

      <div className="frx-paper flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t("nav.openMenu")}>
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 border-none bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground"
            >
              <SidebarBody
                onNavigate={() => setOpen(false)}
                onSearch={() => {
                  setOpen(false);
                  setSearchOpen(true);
                }}
              />
            </SheetContent>
          </Sheet>

          <nav aria-label="Breadcrumb" className="frx-label hidden min-w-0 items-center gap-2 text-muted-foreground sm:flex">
            <span className="text-foreground">FRX</span>
            {showClientCrumb ? (
              <>
                <span className="text-primary">/</span>
                <span className="max-w-[16rem] truncate">{selectedClient.company_name}</span>
              </>
            ) : null}
            <span className="text-primary">/</span>
            <span className="truncate text-foreground">{pageLabel}</span>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <ClockBadge />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden h-8 items-center gap-2 rounded-sm border bg-card px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground md:flex"
            >
              <Search className="size-3.5" />
              {t("nav.search")}
              <kbd className="frx-label ml-2 text-[9px] opacity-70">Ctrl K</kbd>
            </button>
            {realUser?.is_admin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="frx-label h-8 gap-1.5 rounded-sm px-2.5 text-[10px]">
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
                  {(
                    [
                      ["admin", Shield, "viewAs.admin"],
                      ["staff", Users, "viewAs.staff"],
                      ["client", Eye, "viewAs.client"],
                    ] as const
                  ).map(([mode, Icon, label]) => (
                    <DropdownMenuItem key={mode} onClick={() => chooseView(mode)}>
                      <Icon className="size-3.5" />
                      {t(label)}
                      {viewAs === mode ? <Check className="ml-auto size-3.5" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <div className="flex items-center overflow-hidden rounded-sm border">
              {(["en", "fr"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={locale === code}
                  onClick={() => {
                    setLocale(code);
                    void updateProfile({ locale: code });
                  }}
                  className={cn(
                    "frx-label min-w-9 px-2 py-2 text-[10px]",
                    locale === code ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
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

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
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
