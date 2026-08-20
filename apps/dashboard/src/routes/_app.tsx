import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { getMockOnboardingState } from '@/lib/onboarding'
import { WorkspaceProvider } from '@/lib/workspace'

export const Route = createFileRoute('/_app')({
  beforeLoad: () => {
    if (!getMockOnboardingState()?.onboardingComplete) {
      throw redirect({ to: '/onboarding/workspace' })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <WorkspaceProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  )
}
