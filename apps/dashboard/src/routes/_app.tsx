import { Outlet, createFileRoute, Link, redirect } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { getAuthSession } from '@/lib/auth'
import { OrganizationProvider } from '@/lib/organization-context'
import { useOrganization } from '@/lib/organization-context'
import { useCan, PermissionProvider } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { Permission, OrganizationOnboardingStatus } from '@encois/contracts'
import { LoaderCircle } from 'lucide-react'

export const Route = createFileRoute('/_app')({
  beforeLoad: () => {
    if (!getAuthSession()) {
      throw redirect({ to: '/login' })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <PermissionProvider>
      <OrganizationProvider>
        <OrganizationReadinessGate />
      </OrganizationProvider>
    </PermissionProvider>
  )
}

function OrganizationReadinessGate() {
  const { error, errorCode, isLoading, onboarding } = useOrganization()
  const canManageOnboarding = useCan(Permission.OnboardingManage)
  const queryClient = useQueryClient()

  if (isLoading) {
    return <ReadinessFrame><LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="Loading workspace readiness" /></ReadinessFrame>
  }

  if (errorCode === 'ORGANIZATION_ONBOARDING_NOT_FOUND') {
    return (
      <ReadinessFrame>
        <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace readiness</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Onboarding state is unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">This organization has no control-plane onboarding state, so the workspace is paused until setup data is available. Apply the current control-plane migration, then check again.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.organization() })}>Check again</Button>
            {canManageOnboarding ? <Button asChild><Link to="/onboarding/workspace">Open onboarding</Link></Button> : null}
          </div>
        </div>
      </ReadinessFrame>
    )
  }

  if (error || !onboarding) {
    return <ReadinessFrame><div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace readiness</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">Workspace is unavailable</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{error ?? 'The organization readiness response was incomplete.'}</p><Button className="mt-6" variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.organization() })}>Check again</Button></div></ReadinessFrame>
  }

  if (onboarding.status !== OrganizationOnboardingStatus.Ready) {
    const initializing = onboarding.status === OrganizationOnboardingStatus.Initializing
    const failed = onboarding.status === OrganizationOnboardingStatus.Failed
    return <ReadinessFrame><div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-sm sm:p-8"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace readiness</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">{initializing ? 'Workspace setup is in progress' : failed ? 'Workspace setup needs attention' : 'Finish workspace setup'}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{initializing ? 'The Coordinator is bootstrapping organization context. Product surfaces will unlock after the control plane reports completion.' : failed ? (onboarding.lastError ?? 'The Coordinator could not complete bootstrap. Retry setup from onboarding.') : 'Complete onboarding before using the dashboard, integrations, workflows, or organization administration.'}</p>{!canManageOnboarding && !initializing ? <p className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">Ask your organization administrator to complete setup.</p> : null}<div className="mt-6 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.organization() })}>{initializing ? 'Check status' : 'Refresh status'}</Button>{canManageOnboarding && !initializing ? <Button asChild><Link to="/onboarding/workspace">Open onboarding</Link></Button> : null}</div></div></ReadinessFrame>
  }

  return <AppShell><Outlet /></AppShell>
}

function ReadinessFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">{children}</div>
}
