import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAuthSession, getAuthUserKey, isDashboardMockMode } from '@/lib/auth'
import { getMockOnboardingState, type MockOnboardingState } from '@/lib/onboarding'
import { useOrganization } from '@/lib/organization-context'

export function workspaceQueryKey() {
  return ['workspace', getAuthSession()?.organizationId ?? 'unscoped', getAuthUserKey()] as const
}

type WorkspaceContextValue = {
  workspace: MockOnboardingState | null
  isLoading: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const mockMode = isDashboardMockMode()
  const organization = useOrganization()
  const query = useQuery({
    queryKey: workspaceQueryKey(),
    queryFn: getMockOnboardingState,
    enabled: mockMode,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const apiWorkspace = organization.onboarding ? {
    onboardingComplete: organization.onboarding.status === 'ready',
    initializationBannerDismissed: organization.onboarding.status === 'ready',
    workspaceName: organization.organizationName ?? undefined,
    coordinationMode: organization.onboarding.coordinationMode,
    selectedWorkflows: [...organization.onboarding.selectedWorkflows],
    status: organization.onboarding.status === 'initializing' ? 'initializing' : organization.onboarding.status === 'ready' ? 'ready' : 'pending-initialization',
  } satisfies MockOnboardingState : null

  return (
    <WorkspaceContext.Provider value={{ workspace: mockMode ? query.data ?? null : apiWorkspace, isLoading: mockMode ? query.isLoading : organization.isLoading }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return context
}
