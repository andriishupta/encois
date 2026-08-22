import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAuthSession, getAuthUserKey, isDashboardMockMode } from '@/lib/auth'
import { getMockOnboardingState, type MockOnboardingState } from '@/lib/onboarding'

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
  const query = useQuery({
    queryKey: workspaceQueryKey(),
    queryFn: getMockOnboardingState,
    enabled: mockMode,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  return (
    <WorkspaceContext.Provider value={{ workspace: query.data ?? null, isLoading: query.isLoading }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return context
}
