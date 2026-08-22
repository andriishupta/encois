import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { getAuthSession, hasPermission, isDashboardMockMode } from '@/lib/auth'
import { getMockOnboardingState } from '@/lib/onboarding'
import { OrganizationProvider } from '@/lib/organization-context'
import { WorkspaceProvider } from '@/lib/workspace'
import { PermissionProvider } from '@/lib/permissions'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app')({
  beforeLoad: () => {
    if (!getAuthSession()) {
      throw redirect({ to: '/login' })
    }
    if (isDashboardMockMode() && hasPermission(getAuthSession(), Permission.OnboardingManage) && !getMockOnboardingState()?.onboardingComplete) {
      throw redirect({ to: '/onboarding/workspace' })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <PermissionProvider>
      <OrganizationProvider>
        <WorkspaceProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </WorkspaceProvider>
      </OrganizationProvider>
    </PermissionProvider>
  )
}
