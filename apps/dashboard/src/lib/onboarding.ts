import { getAuthSession, getAuthUserKey } from '@/lib/auth'

export type MemorySource = 'slack' | 'github' | 'jira' | 'linear' | 'document'
export type CoordinationMode = 'start-coordinator' | 'connect-only'
export type WorkspaceInitializationStatus = 'pending-initialization' | 'initializing' | 'ready'

export type MockOnboardingState = {
  onboardingComplete: boolean
  initializationBannerDismissed?: boolean
  email?: string
  workspaceName?: string
  teamSize?: string
  projectCount?: string
  companyWebsite?: string
  memorySource?: MemorySource
  memorySourceLabel?: string
  memorySourceId?: string
  coordinationMode?: CoordinationMode
  selectedWorkflows: string[]
  status: WorkspaceInitializationStatus
}

const STORAGE_KEY_PREFIX = 'encois.mock.onboarding'
const STORAGE_VERSION = 1 as const

const emptyState: MockOnboardingState = {
  onboardingComplete: false,
  initializationBannerDismissed: false,
  selectedWorkflows: [],
  status: 'pending-initialization',
}

function storageKey(): string {
  const organizationId = getAuthSession()?.organizationId ?? 'unscoped'
  return `${STORAGE_KEY_PREFIX}.${organizationId}.${encodeURIComponent(getAuthUserKey())}`
}

export function getMockOnboardingState(): MockOnboardingState | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(storageKey())
    if (!stored) return null

    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const value = parsed as Record<string, unknown>
    if (value.storageVersion !== STORAGE_VERSION || !Array.isArray(value.selectedWorkflows) || !value.selectedWorkflows.every((item) => typeof item === 'string')) return null

    const { storageVersion: _storageVersion, ...state } = value
    return { ...emptyState, ...state } as MockOnboardingState
  } catch {
    return null
  }
}

export function updateMockOnboardingState(patch: Partial<MockOnboardingState>) {
  const next = { ...emptyState, ...getMockOnboardingState(), ...patch }

  try {
    window.localStorage.setItem(storageKey(), JSON.stringify({ storageVersion: STORAGE_VERSION, ...next }))
  } catch {
    // The UI remains usable when browser storage is unavailable.
  }

  return next
}
