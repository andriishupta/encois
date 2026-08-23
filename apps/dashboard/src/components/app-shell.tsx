import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  Bell,
  Bookmark,
  BrainCircuit,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  FilePlus2,
  GitBranch,
  ListEnd,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Plus,
  PlugZap,
  Settings,
  UserRound,
  Waypoints,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { authSessionEventName, clearAuthSession, getAuthSession } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { flattenUnitOptions, formatUnitPath, getOrganizationUnit } from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'
import { usePermissions } from '@/lib/permissions'
import { getAccountSummary } from '@/lib/account'
import { getBranding } from '@/lib/branding'
import { isNavigationItemActive, type NavigationTarget } from '@/lib/navigation'
import { Permission, type PermissionKey } from '@encois/contracts'

type NavigationItem = {
  label: string
  to: NavigationTarget
  icon: typeof LayoutDashboard
  permission?: PermissionKey
  anyPermission?: readonly PermissionKey[]
}

const workspaceNavigation: readonly NavigationItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Review', to: '/review', icon: CircleGauge, anyPermission: [Permission.WorkflowsRead, Permission.IntegrationsRead, Permission.KnowledgeRead] },
] as const

const workflowNavigation: readonly NavigationItem[] = [
  { label: 'Workflows', to: '/workflows', icon: ListEnd, permission: Permission.WorkflowsRead },
  { label: 'Runs', to: '/workflows/runs', icon: Activity, permission: Permission.WorkflowsRead },
  { label: 'Memory', to: '/workflows/memory', icon: BrainCircuit, permission: Permission.MemoryRead },
  { label: 'Templates', to: '/workflows/templates', icon: FilePlus2, permission: Permission.WorkflowsRead },
  { label: 'Blueprints', to: '/workflows/blueprints', icon: GitBranch, permission: Permission.WorkflowsRead },
] as const

const organizationNavigation: readonly NavigationItem[] = [
  { label: 'Organization', to: '/organization', icon: Building2, permission: Permission.OrganizationRead },
  { label: 'Memory', to: '/organization/memory', icon: Network, permission: Permission.ContextRead },
  { label: 'Sources', to: '/organization/sources', icon: Waypoints, permission: Permission.KnowledgeRead },
  { label: 'Integrations', to: '/organization/integrations', icon: PlugZap, permission: Permission.IntegrationsRead },
  { label: 'Investigations', to: '/organization/investigations', icon: Bookmark, anyPermission: [Permission.OrganizationManage, Permission.WorkflowsRead, Permission.KnowledgeRead, Permission.ContextRead, Permission.MemoryRead] },
  { label: 'Permissions', to: '/organization/permissions', icon: ClipboardCheck, permission: Permission.OrganizationManage },
  { label: 'Access', to: '/organization/access', icon: UserRound, permission: Permission.OrganizationRead },
] as const

const settingsNavigation: readonly NavigationItem[] = [
  { label: 'Workspace', to: '/settings/workspace', icon: Settings, permission: Permission.SettingsRead },
  { label: 'Notifications', to: '/settings/notifications', icon: Bell, anyPermission: [Permission.SettingsRead, Permission.WorkflowsRead, Permission.KnowledgeRead] },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [organizationOpen, setOrganizationOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { organizationName, units, members, currentUnitId, setCurrentUnitId } = useOrganization()
  const { can } = usePermissions()
  const branding = getBranding(organizationName)
  const workspaceName = branding.workspaceName
  const account = getAccountSummary(members)
  const organizationUnitOptions = flattenUnitOptions(units)
  const currentUnit = getOrganizationUnit(units, currentUnitId) ?? units[0]
  const currentScopeLabel = currentUnit ? currentUnit.id === 'organization' ? 'All organization units' : formatUnitPath(units, currentUnit.id) : 'Organization scope unavailable'

  useEffect(() => {
    const handleSessionChange = () => {
      if (!getAuthSession()) void navigate({ to: '/login' })
    }
    window.addEventListener(authSessionEventName(), handleSessionChange)
    return () => window.removeEventListener(authSessionEventName(), handleSessionChange)
  }, [navigate])

  useEffect(() => {
    setAccountOpen(false)
  }, [pathname])

  function handleLogout() {
    clearAuthSession()
    void navigate({ to: '/login' })
  }

  const closeNavigation = () => setMobileOpen(false)

  return (
    <div className="min-h-svh bg-muted/30 lg:flex lg:pl-64">
      {mobileOpen ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={closeNavigation} /> : null}

      <aside className={cn('fixed inset-y-0 left-0 z-50 flex h-svh max-h-svh w-72 flex-col overflow-hidden border-r bg-background transition-transform duration-200 lg:fixed lg:z-50 lg:w-64 lg:shrink-0 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
        <div className="flex h-16 items-center justify-between border-b px-5">
          <Link to="/" className="min-w-0 truncate font-semibold" onClick={closeNavigation}>{branding.productName}</Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={closeNavigation} aria-label="Close navigation"><X /></Button>
        </div>

        <div className="relative border-b px-3 py-3">
          <button type="button" aria-expanded={organizationOpen} onClick={() => setOrganizationOpen((value) => !value)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent">
            <span className="flex size-8 items-center justify-center rounded-md border bg-background"><CircleGauge className="size-4 text-muted-foreground" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{workspaceName}</span><span className="block truncate text-xs text-muted-foreground">{currentScopeLabel}</span></span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
          {organizationOpen ? <div className="absolute inset-x-3 top-[calc(100%-0.5rem)] z-10 rounded-lg border bg-background p-1 shadow-lg">
            <p className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Change organization unit</p>
            <div className="max-h-64 overflow-y-auto">
              {organizationUnitOptions.map(({ unit, depth }) => <button key={unit.id} type="button" onClick={() => { setCurrentUnitId(unit.id); setOrganizationOpen(false) }} className={cn('flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm hover:bg-accent', currentUnitId === unit.id && 'bg-accent')} style={{ paddingLeft: `${8 + depth * 14}px` }}><span className="min-w-0 flex-1 truncate">{unit.name}</span>{currentUnitId === unit.id ? <span className="text-[11px] text-muted-foreground">Current</span> : null}</button>)}
            </div>
            <div className="mt-1 border-t pt-1"><Link to="/organization" onClick={() => setOrganizationOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="size-3.5" aria-hidden="true" />Manage organization units</Link></div>
          </div> : null}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="Main navigation">
          <div className="flex flex-col gap-6">
            <NavSection label="Workspace" pathname={pathname} items={visibleNavigation(workspaceNavigation, can)} onNavigate={closeNavigation} />
            <NavSection label="Workflows" pathname={pathname} items={visibleNavigation(workflowNavigation, can)} onNavigate={closeNavigation} />
            <NavSection label="Organization" pathname={pathname} items={visibleNavigation(organizationNavigation, can)} onNavigate={closeNavigation} />
            <NavSection label="Settings" pathname={pathname} items={visibleNavigation(settingsNavigation, can)} onNavigate={closeNavigation} />
          </div>
        </nav>

        <div className="border-t p-3">
          <Link to="/profile" onClick={closeNavigation} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{account.initials}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{account.name}</span><span className="block truncate text-xs text-muted-foreground">{account.email}</span></span>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button>
          <Breadcrumbs pathname={pathname} rootLabel={workspaceName} />
          <div className="relative ml-auto">
            <Button variant="outline" size="sm" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}><UserRound data-icon="inline-start" /><span className="hidden max-w-36 truncate text-left sm:block">{account.name}</span><ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" /></Button>
            {accountOpen ? <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-lg border bg-background p-2 shadow-lg">
              <div className="border-b px-2 pb-3 pt-1"><p className="truncate text-sm font-medium">{account.name}</p><p className="truncate text-xs text-muted-foreground">{account.email}</p></div>
              <Link role="menuitem" to="/profile" onClick={() => setAccountOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><UserRound className="size-4" aria-hidden="true" />Account</Link>
              <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); handleLogout() }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><LogOut className="size-4" aria-hidden="true" />Log out</button>
            </div> : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  )
}

function visibleNavigation(items: readonly NavigationItem[], can: (permission: PermissionKey) => boolean): readonly NavigationItem[] {
  return items.filter((item) => (!item.permission || can(item.permission)) && (!item.anyPermission || item.anyPermission.some(can)))
}

function NavSection({ label, pathname, items, onNavigate }: { label: string; pathname: string; items: readonly NavigationItem[]; onNavigate: () => void }) {
  if (!items.length) return null
  return <div className="flex flex-col gap-2">
    {label ? <p className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p> : null}
    <div className="flex flex-col gap-1">{items.map((item) => { const Icon = item.icon; const active = isNavigationItemActive(pathname, item.to); return <Link key={item.to} to={item.to} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground', active && 'bg-accent text-accent-foreground')}><Icon className="size-4" aria-hidden="true" /><span>{item.label}</span></Link> })}</div>
  </div>
}

function Breadcrumbs({ pathname, rootLabel }: { pathname: string; rootLabel: string }) {
  const items = getBreadcrumbItems(pathname)
  return <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm"><Link to="/" className="max-w-40 truncate text-muted-foreground transition-colors hover:text-foreground">{rootLabel}</Link>{items.map((item) => <span key={item.label} className="flex min-w-0 items-center gap-1.5"><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{item.to ? <Link to={item.to} className="truncate text-muted-foreground transition-colors hover:text-foreground">{item.label}</Link> : <span className="truncate font-medium">{item.label}</span>}</span>)}</nav>
}

type BreadcrumbRoute = '/' | '/workflows' | '/workflows/runs' | '/workflows/templates' | '/workflows/blueprints' | '/workflows/memory' | '/organization' | '/organization/memory' | '/organization/sources' | '/organization/integrations' | '/organization/investigations' | '/organization/permissions' | '/organization/access' | '/review' | '/settings' | '/settings/workspace' | '/settings/notifications' | '/profile'

function getBreadcrumbItems(pathname: string): { label: string; to?: BreadcrumbRoute }[] {
  if (pathname === '/') return [{ label: 'Dashboard' }]
  if (pathname === '/workflows') return [{ label: 'Workflows' }]
  if (pathname === '/workflows/runs') return [{ label: 'Workflows', to: '/workflows' }, { label: 'Runs' }]
  if (pathname === '/workflows/templates') return [{ label: 'Workflows', to: '/workflows' }, { label: 'Templates' }]
  if (pathname === '/workflows/blueprints') return [{ label: 'Workflows', to: '/workflows' }, { label: 'Blueprints' }]
  if (pathname.startsWith('/workflows/blueprints/')) return [{ label: 'Workflows', to: '/workflows' }, { label: 'Blueprints', to: '/workflows/blueprints' }, { label: 'Blueprint revision' }]
  if (pathname === '/workflows/new') return [{ label: 'Workflows', to: '/workflows' }, { label: 'New workflow' }]
  if (pathname === '/workflows/memory') return [{ label: 'Workflows', to: '/workflows' }, { label: 'Memory' }]
  if (pathname.startsWith('/workflows/')) return [{ label: 'Workflows', to: '/workflows' }, { label: 'Runs' }]
  if (pathname === '/review') return [{ label: 'Review' }]
  if (pathname === '/organization/memory') return [{ label: 'Organization', to: '/organization' }, { label: 'Memory' }]
  if (pathname === '/organization/sources') return [{ label: 'Organization', to: '/organization' }, { label: 'Sources' }]
  if (pathname === '/organization/sources/new') return [{ label: 'Organization', to: '/organization' }, { label: 'Sources', to: '/organization/sources' }, { label: 'Add source' }]
  if (pathname.startsWith('/organization/sources/')) return [{ label: 'Organization', to: '/organization' }, { label: 'Sources', to: '/organization/sources' }, { label: 'Source details' }]
  if (pathname === '/organization/integrations') return [{ label: 'Organization', to: '/organization' }, { label: 'Integrations' }]
  if (pathname === '/organization/integrations/new') return [{ label: 'Organization', to: '/organization' }, { label: 'Integrations', to: '/organization/integrations' }, { label: 'Add integration' }]
  if (pathname.startsWith('/organization/integrations/')) return [{ label: 'Organization', to: '/organization' }, { label: 'Integrations', to: '/organization/integrations' }, { label: getIntegrationLabel(pathname) }]
  if (pathname === '/organization/investigations') return [{ label: 'Organization', to: '/organization' }, { label: 'Investigations' }]
  if (pathname === '/organization') return [{ label: 'Organization' }]
  if (pathname === '/organization/permissions') return [{ label: 'Organization', to: '/organization' }, { label: 'Permissions' }]
  if (pathname === '/settings') return [{ label: 'Settings' }]
  if (pathname === '/settings/workspace') return [{ label: 'Settings', to: '/settings' }, { label: 'Workspace' }]
  if (pathname === '/settings/notifications') return [{ label: 'Settings', to: '/settings' }, { label: 'Notifications' }]
  if (pathname === '/organization/access') return [{ label: 'Organization', to: '/organization' }, { label: 'Access' }]
  if (pathname === '/profile') return [{ label: 'Account' }]
  return [{ label: 'Dashboard', to: '/' }]
}

function getIntegrationLabel(pathname: string) {
  const id = pathname.split('/').pop()
  if (id === 'github') return 'GitHub integration'
  if (id === 'jira') return 'Jira integration'
  return 'Integration'
}
