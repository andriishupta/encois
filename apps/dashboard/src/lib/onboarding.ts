export type MemorySource = 'slack' | 'github' | 'jira' | 'linear' | 'document'
export type CoordinationMode = 'start-coordinator' | 'connect-only'
export type WorkspaceInitializationStatus = 'pending-initialization' | 'initializing' | 'ready'

export type MockOnboardingState = {
  onboardingComplete: boolean
  email?: string
  workspaceName?: string
  teamSize?: string
  projectCount?: string
  companyWebsite?: string
  memorySource?: MemorySource
  memorySourceLabel?: string
  coordinationMode?: CoordinationMode
  selectedWorkflows: string[]
  status: WorkspaceInitializationStatus
}

const STORAGE_KEY = 'encois.mock.onboarding'

const emptyState: MockOnboardingState = {
  onboardingComplete: false,
  selectedWorkflows: [],
  status: 'pending-initialization',
}

export function getMockOnboardingState(): MockOnboardingState | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? { ...emptyState, ...JSON.parse(stored) } : null
  } catch {
    return null
  }
}

export function updateMockOnboardingState(patch: Partial<MockOnboardingState>) {
  const next = { ...emptyState, ...getMockOnboardingState(), ...patch }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The UI remains usable when browser storage is unavailable.
  }

  return next
}
