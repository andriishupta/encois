import type {
  AuthStatusResponse,
  IntegrationProjection,
  IntegrationUpdateRequest,
  WaitlistRequest,
  WaitlistSubmissionResponse,
  WorkflowExecutionProjection,
  WorkflowSignalRequest,
  WorkflowStartRequest,
  WorkflowUpdateRequest,
} from '@encois/contracts'
import { IntegrationStatus, validateWaitlistRequest, WorkflowExecutionStatus, WorkflowStatusReason } from '@encois/contracts'
import { clearAuthSession, getAuthSessionToken, setAuthOrganizationId } from '@/lib/auth'

const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
const apiBaseUrl = (environment.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')

type ApiEnvelope<T> = { data: T }
type ApiErrorPayload = { error?: { code?: string; message?: string } }

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function errorPayload(value: unknown): ApiErrorPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const error = (value as Record<string, unknown>).error
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null
  const record = error as Record<string, unknown>
  return {
    error: {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkflowProjection(value: unknown): value is WorkflowExecutionProjection {
  if (!isRecord(value)) return false
  if (typeof value.workflowId !== 'string' || typeof value.workflowType !== 'string' || typeof value.namespace !== 'string' || typeof value.taskQueue !== 'string' || typeof value.organizationId !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false
  if (!Object.values(WorkflowExecutionStatus).includes(value.status as WorkflowExecutionStatus)) return false
  return value.statusReason === undefined || Object.values(WorkflowStatusReason).includes(value.statusReason as WorkflowStatusReason)
}

function isIntegrationProjection(value: unknown): value is IntegrationProjection {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.provider === 'string'
    && Object.values(IntegrationStatus).includes(value.status as IntegrationStatus)
}

function parseList<T>(value: unknown, guard: (item: unknown) => item is T, name: string): readonly T[] {
  if (!Array.isArray(value) || !value.every(guard)) throw new ApiError(200, `API returned an invalid ${name} response.`, 'INVALID_RESPONSE')
  return value
}

function isAcceptedResponse(value: unknown): value is { accepted: true } {
  return isRecord(value) && value.accepted === true
}

function isUpdateResponse(value: unknown): value is { accepted: true; updateId: string } {
  return isRecord(value) && value.accepted === true && typeof value.updateId === 'string'
}

async function request<T>(path: string, init?: RequestInit, requiresAuth = true): Promise<T> {
  const session = requiresAuth ? await getAuthSessionToken() : null
  if (requiresAuth && !session) throw new ApiError(401, 'Authentication is required.', 'UNAUTHENTICATED')

  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  if (session) {
    headers.set('Authorization', `Bearer ${session.accessToken}`)
    if (session.organizationId) headers.set('X-Organization-ID', session.organizationId)
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'The Gateway API could not be reached.', 'API_UNAVAILABLE')
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const payload = errorPayload(body)
    if (response.status === 401) clearAuthSession()
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `API request failed (${response.status})`,
      payload?.error?.code,
    )
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('data' in body)) {
    throw new ApiError(response.status, 'API returned an invalid response.', 'INVALID_RESPONSE')
  }
  return (body as ApiEnvelope<T>).data
}

export function listWorkflows(): Promise<readonly WorkflowExecutionProjection[]> {
  return request<unknown>('/workflows').then((value) => parseList(value, isWorkflowProjection, 'workflow list'))
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const value = await request<unknown>('/auth/me')
  if (!isRecord(value) || (value.status !== 'active' && value.status !== 'pending')) {
    throw new ApiError(200, 'API returned an invalid authentication status.', 'INVALID_RESPONSE')
  }
  if (value.status === 'pending') return { status: 'pending' }
  if (typeof value.userId !== 'string' || typeof value.organizationId !== 'string') {
    throw new ApiError(200, 'API returned an invalid active authentication status.', 'INVALID_RESPONSE')
  }
  setAuthOrganizationId(value.organizationId)
  return {
    status: 'active',
    userId: value.userId,
    organizationId: value.organizationId,
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
  }
}

export function submitWaitlist(input: WaitlistRequest): Promise<WaitlistSubmissionResponse> {
  const validation = validateWaitlistRequest(input)
  if (!validation.ok) {
    return Promise.reject(new ApiError(400, validation.issue.message, 'INVALID_REQUEST'))
  }

  return request<unknown>('/public/waitlist', {
    method: 'POST',
    body: JSON.stringify(validation.value),
  }, false).then((value) => {
    if (!isRecord(value) || value.accepted !== true) throw new ApiError(200, 'API returned an invalid waitlist response.', 'INVALID_RESPONSE')
    return { accepted: true }
  })
}

export async function getWorkflow(workflowId: string): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}`)
  if (!isWorkflowProjection(value)) throw new ApiError(200, 'API returned an invalid workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function startWorkflow(input: WorkflowStartRequest): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>('/workflows', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isWorkflowProjection(value)) throw new ApiError(200, 'API returned an invalid workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function signalWorkflow(workflowId: string, input: WorkflowSignalRequest): Promise<{ accepted: true }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/signals`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isAcceptedResponse(value)) throw new ApiError(200, 'API returned an invalid Signal response.', 'INVALID_RESPONSE')
  return value
}

export async function updateWorkflow(workflowId: string, input: WorkflowUpdateRequest): Promise<{ accepted: true; updateId: string }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/updates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isUpdateResponse(value)) throw new ApiError(200, 'API returned an invalid Update response.', 'INVALID_RESPONSE')
  return value
}

export function listIntegrations(): Promise<readonly IntegrationProjection[]> {
  return request<unknown>('/integrations').then((value) => parseList(value, isIntegrationProjection, 'integration list'))
}

export async function updateIntegration(integrationId: string, input: IntegrationUpdateRequest): Promise<IntegrationProjection> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isIntegrationProjection(value)) throw new ApiError(200, 'API returned an invalid integration response.', 'INVALID_RESPONSE')
  return value
}
