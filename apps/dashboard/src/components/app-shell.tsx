import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  PlugZap,
  Settings,
  UserRound,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { authSessionEventName, clearAuthSession, getAuthSession } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/workspace'
import { flattenUnitOptions, formatUnitPath, getOrganizationUnit } from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'

const primaryNavigation = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Workflows', to: '/workflows', icon: GitBranch },
  { label: 'Integrations', to: '/integrations', icon: PlugZap },
] as const

const secondaryNavigation = [
  { label: 'Organization', to: '/organization', icon: Building2 },
  { label: 'Settings', to: '/settings', icon: Settings },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [organizationOpen, setOrganizationOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { workspace } = useWorkspace()
  const { units, currentUnitId, setCurrentUnitId } = useOrganization()
  const workspaceName = workspace?.workspaceName ?? 'Acme workspace'
  const organizationUnitOptions = flattenUnitOptions(units)
  const currentUnit = getOrganizationUnit(units, currentUnitId) ?? units[0]
  const currentScopeLabel = currentUnit.id === 'organization' ? 'All organization units' : formatUnitPath(units, currentUnit.id)

  useEffect(() => {
    const handleSessionChange = () => {
      if (!getAuthSession()) void navigate({ to: '/login' })
    }
    window.addEventListener(authSessionEventName(), handleSessionChange)
    return () => window.removeEventListener(authSessionEventName(), handleSessionChange)
  }, [navigate])

  function handleLogout() {
    clearAuthSession()
    void navigate({ to: '/login' })
  }

  return (
    <div className="min-h-svh bg-muted/30 lg:flex lg:pl-64">
      {mobileOpen ? (
        <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setMobileOpen(false)} />
      ) : null}

      <aside className={cn('fixed inset-y-0 left-0 z-50 flex h-svh max-h-svh w-72 flex-col overflow-hidden border-r bg-background transition-transform duration-200 lg:fixed lg:z-50 lg:w-64 lg:shrink-0 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
        <div className="flex h-16 items-center justify-between border-b px-5">
          <Link to="/" className="flex items-center gap-2 font-semibold" onClick={() => setMobileOpen(false)}>
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" aria-hidden="true" />
            </span>
            Encois
          </Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X />
          </Button>
        </div>

        <div className="relative border-b px-3 py-3">
          <button type="button" aria-expanded={organizationOpen} onClick={() => setOrganizationOpen((value) => !value)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent">
            <span className="flex size-8 items-center justify-center rounded-md border bg-background">
              <CircleGauge className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{workspaceName}</span>
              <span className="block truncate text-xs text-muted-foreground">{currentScopeLabel}</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
          {organizationOpen ? <div className="absolute inset-x-3 top-[calc(100%-0.5rem)] z-10 rounded-lg border bg-background p-1 shadow-lg">
            <p className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Change organization unit</p>
            <div className="max-h-64 overflow-y-auto">
              {organizationUnitOptions.map(({ unit, depth }) => <button key={unit.id} type="button" onClick={() => { setCurrentUnitId(unit.id); setOrganizationOpen(false) }} className={cn('flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm hover:bg-accent', currentUnitId === unit.id && 'bg-accent')} style={{ paddingLeft: `${8 + depth * 14}px` }}>
                <span className="min-w-0 flex-1 truncate">{unit.name}</span>
                {currentUnitId === unit.id ? <span className="text-[11px] text-muted-foreground">Current</span> : null}
              </button>)}
            </div>
            <div className="mt-1 border-t pt-1">
              <Link to="/organization" onClick={() => setOrganizationOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                <Plus className="size-3.5" aria-hidden="true" />
                Manage organization units
              </Link>
            </div>
          </div> : null}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="Main navigation">
          <div className="flex flex-col gap-6">
            <NavSection label="Workspace" items={primaryNavigation} onNavigate={() => setMobileOpen(false)} />
            <NavSection label="Manage" items={secondaryNavigation} onNavigate={() => setMobileOpen(false)} />
          </div>
        </nav>

        <div className="border-t p-3">
          <Link to="/profile" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent">
            <span className="flex size-8 items-center justify-center rounded-full bg-muted">
              <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Workspace member</span>
              <span className="block truncate text-xs text-muted-foreground">Account</span>
            </span>
          </Link>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => { setMobileOpen(false); handleLogout() }}>
            <LogOut data-icon="inline-start" />
            Log out
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <Breadcrumbs pathname={pathname} rootLabel={workspaceName} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/profile" aria-label="Account">
                <UserRound data-icon="inline-start" />
                <span className="hidden sm:inline">Account</span>
              </Link>
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  )
}

function NavSection({
  label,
  items,
  onNavigate,
}: {
  label: string
  items: readonly { label: string; to: '/' | '/workflows' | '/integrations' | '/organization' | '/settings'; icon: typeof LayoutDashboard }[]
  onNavigate: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.to} to={item.to} onClick={onNavigate} activeProps={{ className: 'bg-accent text-accent-foreground' }} className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
              <Icon className="size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Breadcrumbs({ pathname, rootLabel }: { pathname: string; rootLabel: string }) {
  const items = getBreadcrumbItems(pathname)

  return <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm"><Link to="/" className="max-w-40 truncate text-muted-foreground transition-colors hover:text-foreground">{rootLabel}</Link>{items.map((item) => <span key={item.label} className="flex min-w-0 items-center gap-1.5"><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{item.to ? <Link to={item.to} className="truncate text-muted-foreground transition-colors hover:text-foreground">{item.label}</Link> : <span className="truncate font-medium">{item.label}</span>}</span>)}</nav>
}

type BreadcrumbRoute = '/' | '/workflows' | '/integrations' | '/organization' | '/organization/permissions' | '/settings' | '/settings/workspace' | '/settings/notifications' | '/settings/access' | '/profile'

function getBreadcrumbItems(pathname: string): { label: string; to?: BreadcrumbRoute }[] {
  if (pathname === '/') return [{ label: 'Dashboard' }]
  if (pathname === '/workflows') return [{ label: 'Workflows' }]
  if (pathname === '/workflows/new') return [{ label: 'Workflows', to: '/workflows' }, { label: 'New workflow' }]
  if (pathname.startsWith('/workflows/')) return [{ label: 'Workflows', to: '/workflows' }, { label: 'Workflow execution' }]
  if (pathname === '/integrations') return [{ label: 'Integrations' }]
  if (pathname === '/integrations/new') return [{ label: 'Integrations', to: '/integrations' }, { label: 'Add integration' }]
  if (pathname.startsWith('/integrations/')) return [{ label: 'Integrations', to: '/integrations' }, { label: getIntegrationLabel(pathname) }]
  if (pathname === '/organization') return [{ label: 'Organization' }]
  if (pathname === '/organization/permissions') return [{ label: 'Organization', to: '/organization' }, { label: 'Permissions' }]
  if (pathname === '/settings') return [{ label: 'Settings' }]
  if (pathname === '/settings/workspace') return [{ label: 'Settings', to: '/settings' }, { label: 'Workspace' }]
  if (pathname === '/settings/notifications') return [{ label: 'Settings', to: '/settings' }, { label: 'Notifications' }]
  if (pathname === '/settings/access') return [{ label: 'Settings', to: '/settings' }, { label: 'Access' }]
  if (pathname === '/profile') return [{ label: 'Profile' }]
  return [{ label: 'Dashboard', to: '/' }]
}

function getIntegrationLabel(pathname: string) {
  const id = pathname.split('/').pop()
  if (id === 'github') return 'GitHub integration'
  if (id === 'jira') return 'Jira integration'
  return 'Integration'
}
