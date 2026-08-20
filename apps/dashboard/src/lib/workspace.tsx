import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMockOnboardingState, type MockOnboardingState } from '@/lib/onboarding'

export const workspaceQueryKey = ['workspace'] as const

type WorkspaceContextValue = {
  workspace: MockOnboardingState | null
  isLoading: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: getMockOnboardingState,
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

