import { useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  ChevronDown,
  CircleGauge,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  PlugZap,
  Settings,
  UserRound,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/workspace'

const primaryNavigation = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Current workflows', to: '/workflows', icon: GitBranch },
  { label: 'Integrations', to: '/integrations', icon: PlugZap },
] as const

const secondaryNavigation = [{ label: 'Settings', to: '/settings', icon: Settings }] as const

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const pageTitle = getPageTitle(pathname)
  const { workspace } = useWorkspace()
  const workspaceName = workspace?.workspaceName ?? 'Acme workspace'

  return (
    <div className="min-h-svh bg-muted/30 lg:flex">
      {mobileOpen ? (
        <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setMobileOpen(false)} />
      ) : null}

      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-background transition-transform duration-200 lg:static lg:z-auto lg:flex lg:w-64 lg:shrink-0 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
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

        <div className="border-b px-3 py-3">
          <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent">
            <span className="flex size-8 items-center justify-center rounded-md border bg-background">
              <CircleGauge className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{workspaceName}</span>
              <span className="block truncate text-xs text-muted-foreground">Organization scope</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Main navigation">
          <NavSection label="Workspace" items={primaryNavigation} onNavigate={() => setMobileOpen(false)} />
          <NavSection label="Manage" items={secondaryNavigation} onNavigate={() => setMobileOpen(false)} />
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
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" asChild>
            <Link to="/login" onClick={() => setMobileOpen(false)}>
              <LogOut data-icon="inline-start" />
              Log out
            </Link>
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">Encois</span>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <span className="truncate font-medium">{pageTitle}</span>
          </div>
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
  items: readonly { label: string; to: '/' | '/workflows' | '/integrations' | '/settings'; icon: typeof LayoutDashboard }[]
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

function getPageTitle(pathname: string) {
  if (pathname === '/workflows/new') return 'New workflow'
  if (pathname === '/workflows') return 'Current workflows'
  if (pathname.startsWith('/workflows/')) return 'Workflow'
  if (pathname === '/integrations/new') return 'Add integration'
  if (pathname === '/integrations') return 'Integrations'
  if (pathname.startsWith('/integrations/')) return 'Integration'
  if (pathname === '/settings') return 'Settings'
  if (pathname === '/profile') return 'Profile'
  return 'Dashboard'
}
