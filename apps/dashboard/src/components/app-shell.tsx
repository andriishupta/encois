import { Permission, type PermissionKey } from "@encois/contracts/browser";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  Bookmark,
  BookOpen,
  BrainCircuit,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  FilePlus2,
  GitBranch,
  LayoutDashboard,
  ListEnd,
  LockKeyhole,
  LogOut,
  Menu,
  Network,
  PlugZap,
  Plus,
  Settings,
  UserRound,
  Waypoints,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getAccountSummary } from "@/lib/account";
import { listNotificationsPage } from "@/lib/api";
import { clearAuthSession } from "@/lib/auth";
import { getBranding } from "@/lib/branding";
import {
  isNavigationItemActive,
  type NavigationTarget,
} from "@/lib/navigation";
import {
  flattenUnitOptions,
  formatUnitParentPath,
  getOrganizationUnit,
  getUnitPath,
} from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

type NavigationItem = {
  label: string;
  to: NavigationTarget;
  icon: typeof LayoutDashboard;
  permission?: PermissionKey;
  anyPermission?: readonly PermissionKey[];
};

const workspaceNavigation: readonly NavigationItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  {
    label: "Activity",
    to: "/activity",
    icon: CircleGauge,
    anyPermission: [
      Permission.WorkflowsRead,
      Permission.IntegrationsRead,
      Permission.KnowledgeRead,
      Permission.MemoryRead,
      Permission.OrganizationRead,
    ],
  },
] as const;

const workflowNavigation: readonly NavigationItem[] = [
  {
    label: "Workflows",
    to: "/workflows",
    icon: ListEnd,
    permission: Permission.WorkflowsRead,
  },
  {
    label: "Runs",
    to: "/workflows/runs",
    icon: Activity,
    permission: Permission.WorkflowsRead,
  },
  {
    label: "Memory",
    to: "/workflows/memory",
    icon: BrainCircuit,
    permission: Permission.MemoryRead,
  },
] as const;

const workflowManagementNavigation: readonly NavigationItem[] = [
  {
    label: "Blueprints",
    to: "/workflows/blueprints",
    icon: GitBranch,
    permission: Permission.WorkflowsRead,
  },
  {
    label: "Change Plans",
    to: "/workflows/plans",
    icon: ClipboardCheck,
    permission: Permission.WorkflowsManage,
  },
  {
    label: "Templates",
    to: "/workflows/templates",
    icon: FilePlus2,
    permission: Permission.WorkflowsRead,
  },
] as const;

const organizationNavigation: readonly NavigationItem[] = [
  {
    label: "Organization",
    to: "/organization",
    icon: Building2,
    permission: Permission.OrganizationRead,
  },
  {
    label: "Memory",
    to: "/organization/memory",
    icon: Network,
    permission: Permission.ContextRead,
  },
  {
    label: "Investigations",
    to: "/organization/investigations",
    icon: Bookmark,
    anyPermission: [
      Permission.OrganizationManage,
      Permission.WorkflowsRead,
      Permission.KnowledgeRead,
      Permission.ContextRead,
      Permission.MemoryRead,
    ],
  },
  {
    label: "Sources",
    to: "/organization/sources",
    icon: Waypoints,
    permission: Permission.KnowledgeRead,
  },
  {
    label: "Integrations",
    to: "/organization/integrations",
    icon: PlugZap,
    permission: Permission.IntegrationsRead,
  },
  {
    label: "Integration Catalog",
    to: "/organization/integrations/catalog",
    icon: PlugZap,
    permission: Permission.IntegrationsRead,
  },
] as const;

const managementNavigation: readonly NavigationItem[] = [
  {
    label: "Members",
    to: "/management/members",
    icon: UserRound,
    permission: Permission.OrganizationRead,
  },
  {
    label: "Access",
    to: "/management/access",
    icon: UserRound,
    permission: Permission.OrganizationRead,
  },
] as const;

const settingsNavigation: readonly NavigationItem[] = [
  {
    label: "Workspace",
    to: "/settings/workspace",
    icon: Settings,
    permission: Permission.SettingsRead,
  },
  {
    label: "Notifications",
    to: "/settings/notifications",
    icon: Bell,
    anyPermission: [
      Permission.SettingsRead,
      Permission.WorkflowsRead,
      Permission.KnowledgeRead,
    ],
  },
  { label: "Documentation", to: "/settings/documentation", icon: BookOpen },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { organizationName, units, members, currentUnitId, setCurrentUnitId } =
    useOrganization();
  const { can } = usePermissions();
  const branding = getBranding(organizationName ?? undefined);
  const workspaceName = branding.workspaceName;
  const account = getAccountSummary(members);
  const organizationUnitOptions = flattenUnitOptions(units);
  const currentUnit = getOrganizationUnit(units, currentUnitId)?.canView
    ? getOrganizationUnit(units, currentUnitId)
    : units.find((unit) => unit.canView);
  const currentUnitLabel = currentUnit?.name ?? workspaceName;
  const currentUnitPath = currentUnit
    ? formatUnitParentPath(units, currentUnit.id) || "All organization units"
    : "Organization scope unavailable";
  const currentBreadcrumbScope =
    currentUnit && currentUnit.type !== "organization"
      ? getUnitPath(units, currentUnit.id)
          .filter((unit) => unit.type !== "organization")
          .map((unit) => unit.name)
      : undefined;
  const canViewNotifications =
    can(Permission.SettingsRead) ||
    can(Permission.WorkflowsRead) ||
    can(Permission.KnowledgeRead);
  const unreadNotifications = useQuery({
    queryKey: queryKeys.notifications("", "unread"),
    queryFn: () => listNotificationsPage({ status: "unread", limit: 1 }),
    enabled: canViewNotifications,
  });
  const unreadCount = unreadNotifications.data?.pagination.total ?? 0;
  const notificationLabel = unreadCount
    ? `Notifications, ${unreadCount} unread`
    : "Notifications";

  useEffect(() => {
    if (!pathname) return;
    setAccountOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearAuthSession();
  }

  function selectOrganizationUnit(unitId: string) {
    const unit = units.find((candidate) => candidate.id === unitId);
    if (!unit?.canView) return;
    setCurrentUnitId(unitId);
    setOrganizationOpen(false);
  }

  const closeNavigation = () => setMobileOpen(false);

  return (
    <div className="min-h-svh bg-muted/30 lg:flex lg:pl-64">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={closeNavigation}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-svh max-h-svh w-72 flex-col overflow-hidden border-r bg-background transition-transform duration-200 lg:fixed lg:z-50 lg:w-64 lg:shrink-0 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-5">
          <Link
            to="/"
            aria-label={`${branding.productName} | ${workspaceName}`}
            className="flex min-w-0 items-center gap-2 truncate"
            onClick={closeNavigation}
          >
            <span className="shrink-0 font-semibold">
              {branding.productName}
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              |
            </span>
            <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
              {workspaceName}
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={closeNavigation}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>

        <div className="relative border-b px-3 py-3">
          <button
            type="button"
            aria-expanded={organizationOpen}
            onClick={() => setOrganizationOpen((value) => !value)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
          >
            <span className="flex size-8 items-center justify-center rounded-md border bg-background">
              <CircleGauge
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {currentUnitLabel}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {currentUnitPath}
              </span>
            </span>
            <ChevronDown
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
          {organizationOpen ? (
            <div className="absolute inset-x-3 top-[calc(100%-0.5rem)] z-10 rounded-lg border bg-background p-1 shadow-lg">
              <p className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Change organization unit
              </p>
              <div className="max-h-64 overflow-y-auto">
                {organizationUnitOptions.map(({ unit, depth }) => (
                  <button
                    key={unit.id}
                    type="button"
                    disabled={!unit.canView}
                    onClick={() => selectOrganizationUnit(unit.id)}
                    title={unit.canView ? undefined : "Access restricted"}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                      currentUnitId === unit.id && "bg-accent",
                    )}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                  >
                    <span className="min-w-0 flex-1 truncate">{unit.name}</span>
                    {!unit.canView ? (
                      <LockKeyhole
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Access restricted"
                      />
                    ) : currentUnitId === unit.id ? (
                      <span className="text-[11px] text-muted-foreground">
                        Current
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {organizationUnitOptions.some(({ unit }) => unit.canManage) ? (
                <div className="mt-1 border-t pt-1">
                  <Link
                    to="/organization"
                    onClick={() => setOrganizationOpen(false)}
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Manage organization units
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
          aria-label="Main navigation"
        >
          <div className="flex flex-col gap-6">
            <NavSection
              label="Workspace"
              pathname={pathname}
              items={visibleNavigation(workspaceNavigation, can)}
              onNavigate={closeNavigation}
            />
            <NavSection
              label="Workflows"
              pathname={pathname}
              items={visibleNavigation(workflowNavigation, can)}
              onNavigate={closeNavigation}
            />
            <NavSection
              label="Workflow Management"
              pathname={pathname}
              items={visibleNavigation(workflowManagementNavigation, can)}
              onNavigate={closeNavigation}
            />
            <NavSection
              label="Organization"
              pathname={pathname}
              items={visibleNavigation(organizationNavigation, can)}
              onNavigate={closeNavigation}
            />
            <NavSection
              label="Organization Management"
              pathname={pathname}
              items={visibleNavigation(managementNavigation, can)}
              onNavigate={closeNavigation}
            />
            <NavSection
              label="Settings"
              pathname={pathname}
              items={visibleNavigation(settingsNavigation, can)}
              onNavigate={closeNavigation}
            />
          </div>
        </nav>

        <div className="border-t p-3">
          <Link
            to="/profile"
            onClick={closeNavigation}
            className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {account.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {account.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {account.email}
              </span>
            </span>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <Breadcrumbs
            pathname={pathname}
            rootLabel={workspaceName}
            productName={branding.productName}
            currentScope={currentBreadcrumbScope}
          />
          {canViewNotifications ? (
            <Button variant="ghost" size="icon" asChild>
              <Link
                to="/settings/notifications"
                aria-label={notificationLabel}
                className="relative"
              >
                <Bell />
                {unreadCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full border border-background bg-muted px-1 text-[9px] font-semibold leading-3.5 text-muted-foreground"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </Link>
            </Button>
          ) : null}
          <div className="relative ml-auto">
            <Button
              variant="outline"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              <UserRound data-icon="inline-start" />
              <span className="hidden max-w-36 truncate text-left sm:block">
                {account.name}
              </span>
              <ChevronDown
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
            </Button>
            {accountOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-lg border bg-background p-2 shadow-lg"
              >
                <div className="border-b px-2 pb-3 pt-1">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.email}
                  </p>
                </div>
                <Link
                  role="menuitem"
                  to="/profile"
                  onClick={() => setAccountOpen(false)}
                  className="mt-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <UserRound className="size-4" aria-hidden="true" />
                  Account
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function visibleNavigation(
  items: readonly NavigationItem[],
  can: (permission: PermissionKey) => boolean,
): readonly NavigationItem[] {
  return items.filter(
    (item) =>
      (!item.permission || can(item.permission)) &&
      (!item.anyPermission || item.anyPermission.some(can)),
  );
}

function NavSection({
  label,
  pathname,
  items,
  onNavigate,
}: {
  label: string;
  pathname: string;
  items: readonly NavigationItem[];
  onNavigate: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <p className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isNavigationItemActive(pathname, item.to);
          return (
            <Link
              key={item.to}
              data-testid={
                item.to === "/workflows" ? "nav-workflows" : undefined
              }
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                active && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Breadcrumbs({
  pathname,
  rootLabel,
  productName,
  currentScope,
}: {
  pathname: string;
  rootLabel: string;
  productName: string;
  currentScope?: readonly string[];
}) {
  const items = getBreadcrumbItems(pathname, productName);
  const scopeLabel = currentScope?.length
    ? [rootLabel, ...currentScope].join(" / ")
    : rootLabel;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap text-sm"
    >
      <Link
        to="/"
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {scopeLabel}
      </Link>
      {items.map((item) => (
        <span key={item.label} className="flex shrink-0 items-center gap-1.5">
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          {item.to ? (
            <Link
              to={item.to}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ) : (
            <span className="font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

type BreadcrumbRoute =
  | "/"
  | "/workflows"
  | "/workflows/runs"
  | "/workflows/templates"
  | "/workflows/blueprints"
  | "/workflows/plans"
  | "/workflows/memory"
  | "/workflows/memory/add"
  | "/organization"
  | "/organization/investigations"
  | "/organization/investigations/$investigationId"
  | "/organization/memory"
  | "/organization/sources"
  | "/organization/sources/new"
  | "/organization/sources/$sourceId"
  | "/organization/units/new"
  | "/organization/integrations"
  | "/organization/integrations/catalog"
  | "/management/members"
  | "/management/members/$memberId"
  | "/management/access"
  | "/activity"
  | "/settings"
  | "/settings/workspace"
  | "/settings/notifications"
  | "/settings/documentation"
  | "/profile";

function getBreadcrumbItems(
  pathname: string,
  productName: string,
): { label: string; to?: BreadcrumbRoute }[] {
  if (pathname === "/") return [{ label: "Dashboard" }];
  if (pathname === "/workflows") return [{ label: "Workflows" }];
  if (pathname === "/workflows/runs")
    return [{ label: "Workflows", to: "/workflows" }, { label: "Runs" }];
  if (pathname === "/workflows/templates")
    return [{ label: "Workflows", to: "/workflows" }, { label: "Templates" }];
  if (pathname === "/workflows/blueprints")
    return [{ label: "Workflows", to: "/workflows" }, { label: "Blueprints" }];
  if (pathname === "/workflows/plans")
    return [
      { label: "Workflows", to: "/workflows" },
      { label: "Change Plans" },
    ];
  if (pathname.startsWith("/workflows/plans/"))
    return [
      { label: "Workflows", to: "/workflows" },
      { label: "Change Plans", to: "/workflows/plans" },
      { label: "Change Plan" },
    ];
  if (pathname.startsWith("/workflows/definitions/"))
    return [
      { label: "Workflows", to: "/workflows" },
      { label: "Workflow definition" },
    ];
  if (pathname.startsWith("/workflows/blueprints/"))
    return [
      { label: "Workflows", to: "/workflows" },
      { label: "Blueprints", to: "/workflows/blueprints" },
      { label: "Blueprint revision" },
    ];
  if (pathname === "/workflows/new")
    return [
      { label: "Workflows", to: "/workflows" },
      { label: "New workflow" },
    ];
  if (pathname === "/workflows/memory")
    return [{ label: "Workflows", to: "/workflows" }, { label: "Memory" }];
  if (pathname.startsWith("/workflows/memory/"))
    return [
      { label: "Workflows", to: "/workflows" },
      { label: "Memory", to: "/workflows/memory" },
      { label: "Add memory" },
    ];
  if (pathname.startsWith("/workflows/"))
    return [{ label: "Workflows", to: "/workflows" }, { label: "Runs" }];
  if (pathname === "/activity") return [{ label: "Activity" }];
  if (pathname === "/organization/memory")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Memory" },
    ];
  if (pathname === "/organization/sources")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Sources" },
    ];
  if (pathname === "/organization/units/new")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Add organization unit" },
    ];
  if (pathname === "/organization/sources/new")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Sources", to: "/organization/sources" },
      { label: "Add source" },
    ];
  if (pathname.startsWith("/organization/sources/"))
    return [
      { label: "Organization", to: "/organization" },
      { label: "Sources", to: "/organization/sources" },
      { label: "Source details" },
    ];
  if (pathname === "/organization/integrations")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Integrations" },
    ];
  if (pathname === "/organization/integrations/catalog")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Integration Catalog" },
    ];
  if (pathname === "/organization/integrations/new")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Integrations", to: "/organization/integrations" },
      { label: "Add integration" },
    ];
  if (pathname.startsWith("/organization/integrations/"))
    return [
      { label: "Organization", to: "/organization" },
      { label: "Integrations", to: "/organization/integrations" },
      { label: getIntegrationLabel(pathname) },
    ];
  if (pathname === "/organization") return [{ label: "Organization" }];
  if (pathname.startsWith("/organization/investigations/"))
    return [
      { label: "Organization", to: "/organization" },
      { label: "Investigations", to: "/organization/investigations" },
      { label: "Investigation" },
    ];
  if (pathname === "/organization/investigations")
    return [
      { label: "Organization", to: "/organization" },
      { label: "Investigations" },
    ];
  if (pathname === "/management/members")
    return [{ label: "Organization Management" }, { label: "Members" }];
  if (pathname.startsWith("/management/members/"))
    return [
      { label: "Organization Management" },
      { label: "Members", to: "/management/members" },
      { label: "Member" },
    ];
  if (pathname === "/settings") return [{ label: "Settings" }];
  if (pathname === "/settings/workspace")
    return [{ label: "Settings", to: "/settings" }, { label: "Workspace" }];
  if (pathname === "/settings/notifications")
    return [{ label: "Settings", to: "/settings" }, { label: "Notifications" }];
  if (pathname === "/settings/documentation")
    return [
      { label: "Settings", to: "/settings" },
      { label: `${productName} Documentation` },
    ];
  if (pathname === "/management/access")
    return [{ label: "Organization Management" }, { label: "Access" }];
  if (pathname === "/profile") return [{ label: "Account" }];
  return [{ label: "Dashboard", to: "/" }];
}

function getIntegrationLabel(pathname: string) {
  const id = pathname.split("/").pop();
  if (id === "github") return "GitHub integration";
  if (id === "jira") return "Jira integration";
  return "Integration";
}
