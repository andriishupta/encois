import { useEffect } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { getMockOnboardingState } from '@/lib/onboarding'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <DocumentTitle />
      <Outlet />
    </>
  )
}

function DocumentTitle() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const workspaceName = getMockOnboardingState()?.workspaceName ?? 'Encois'

  useEffect(() => {
    document.title = `${getPageTitle(pathname)} | ${workspaceName}`
  }, [pathname, workspaceName])

  return null
}

function getPageTitle(pathname: string) {
  if (pathname === '/') return 'Dashboard'
  if (pathname === '/login') return 'Sign in'
  if (pathname === '/sign-up' || pathname === '/waitlist') return 'Join the waitlist'
  if (pathname === '/onboarding/workspace') return 'Workspace setup'
  if (pathname === '/onboarding/memory') return 'Project memory setup'
  if (pathname === '/onboarding/coordination') return 'Coordinator setup'
  if (pathname === '/onboarding/workflows') return 'Workflow setup'
  if (pathname === '/workflows') return 'Workflows'
  if (pathname === '/workflows/new') return 'New workflow'
  if (pathname.startsWith('/workflows/')) return 'Workflow execution'
  if (pathname === '/integrations') return 'Integrations'
  if (pathname === '/integrations/new') return 'Add integration'
  if (pathname.startsWith('/integrations/')) return getIntegrationTitle(pathname)
  if (pathname === '/organization') return 'Organization'
  if (pathname === '/organization/permissions') return 'Organization permissions'
  if (pathname === '/settings') return 'Settings'
  if (pathname === '/settings/workspace') return 'Workspace settings'
  if (pathname === '/settings/notifications') return 'Notifications'
  if (pathname === '/settings/access') return 'Access'
  if (pathname === '/profile') return 'Profile'
  return 'Dashboard'
}

function getIntegrationTitle(pathname: string) {
  const id = pathname.split('/').pop()
  if (id === 'github') return 'GitHub integration'
  if (id === 'jira') return 'Jira integration'
  return 'Integration'
}
