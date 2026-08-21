import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { getAuthSession, isDashboardMockMode } from '@/lib/auth'
import { getMockOnboardingState } from '@/lib/onboarding'
import { OrganizationProvider } from '@/lib/organization-context'
import { WorkspaceProvider } from '@/lib/workspace'

export const Route = createFileRoute('/_app')({
  beforeLoad: () => {
    if (!getAuthSession()) {
      throw redirect({ to: '/login' })
    }
    if (isDashboardMockMode() && !getMockOnboardingState()?.onboardingComplete) {
      throw redirect({ to: '/onboarding/workspace' })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <OrganizationProvider>
      <WorkspaceProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </WorkspaceProvider>
    </OrganizationProvider>
  )
}
