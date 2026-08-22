import type {
  AuthStatusResponse,
  IntegrationProjection,
  IntegrationUpdateRequest,
  OrganizationPermissionCreateRequest,
  OrganizationPermissionProjection,
  OrganizationPermissionUpdateRequest,
  OrganizationProjection,
  OrganizationUnitCreateRequest,
  OrganizationUnitProjection,
  KnowledgeSource,
  SourceIngestionRun,
  SourceRevision,
  WaitlistRequest,
  WaitlistSubmissionResponse,
  WorkflowExecutionProjection,
  WorkflowSignalRequest,
  WorkflowStartRequest,
  WorkflowUpdateRequest,
} from '@encois/contracts'
import { AccessLevel, IntegrationStatus, isJsonObject, KnowledgeSourceKind, KnowledgeSourceStatus, OrganizationMembershipStatus, SourceIngestionTrigger, SourceRevisionStatus, validateWaitlistRequest, WorkflowExecutionStatus, WorkflowStatusReason } from '@encois/contracts'
import { clearAuthSession, getAuthSessionToken, setAuthOrganizationId } from '@/lib/auth'

const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
const apiBaseUrl = (environment.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')

type ApiEnvelope<T> = { data: T }
type ApiErrorPayload = { error?: { code?: string; message?: string } }

export type KnowledgeSourceDetail = {
  source: KnowledgeSource
  revisions: readonly SourceRevision[]
  ingestionRuns: readonly SourceIngestionRun[]
}

export type KnowledgeSourceUpload = { source: KnowledgeSource; revision: SourceRevision }
export type SourceIngestionLaunch = {
  source: KnowledgeSource
  revision: SourceRevision
  workflow: { workflowId: string; runId?: string; status: string; reused?: boolean }
  resultContract: string
}

export type ApiError = Error & {
  name: 'ApiError'
  status: number
  code?: string
}

export function createApiError(status: number, message: string, code?: string): ApiError {
  const error = new Error(message) as ApiError
  error.name = 'ApiError'
  error.status = status
  if (code) error.code = code
  return error
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof Error && value.name === 'ApiError' && typeof (value as Partial<ApiError>).status === 'number'
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

function isWorkflowProjection(value: unknown): value is WorkflowExecutionProjection {
  if (!isJsonObject(value)) return false
  if (typeof value.workflowId !== 'string' || typeof value.workflowType !== 'string' || typeof value.namespace !== 'string' || typeof value.taskQueue !== 'string' || typeof value.organizationId !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false
  if (!Object.values(WorkflowExecutionStatus).includes(value.status as WorkflowExecutionStatus)) return false
  return value.statusReason === undefined || Object.values(WorkflowStatusReason).includes(value.statusReason as WorkflowStatusReason)
}

function isIntegrationProjection(value: unknown): value is IntegrationProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.provider === 'string'
    && Object.values(IntegrationStatus).includes(value.status as IntegrationStatus)
}

function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return isJsonObject(value)
    && value.contractVersion === 'knowledge-source.v1'
    && typeof value.id === 'string'
    && typeof value.organizationId === 'string'
    && typeof value.name === 'string'
    && Object.values(KnowledgeSourceKind).includes(value.kind as KnowledgeSourceKind)
    && Object.values(KnowledgeSourceStatus).includes(value.status as KnowledgeSourceStatus)
    && isJsonObject(value.readScope)
    && Array.isArray(value.readScope.ids)
    && isJsonObject(value.visibilityScope)
    && Array.isArray(value.visibilityScope.ids)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function isSourceRevision(value: unknown): value is SourceRevision {
  return isJsonObject(value)
    && value.contractVersion === 'source-revision.v1'
    && typeof value.id === 'string'
    && typeof value.sourceId === 'string'
    && typeof value.organizationId === 'string'
    && typeof value.revision === 'string'
    && Object.values(SourceRevisionStatus).includes(value.status as SourceRevisionStatus)
    && typeof value.createdAt === 'string'
}

function isSourceIngestionRun(value: unknown): value is SourceIngestionRun {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.sourceId === 'string'
    && typeof value.sourceRevisionId === 'string'
    && typeof value.temporalWorkflowId === 'string'
    && typeof value.trigger === 'string'
    && ['queued', 'running', 'completed', 'deferred', 'failed'].includes(value.status as string)
    && typeof value.factsCount === 'number'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function isKnowledgeSourceDetail(value: unknown): value is KnowledgeSourceDetail {
  return isJsonObject(value)
    && isKnowledgeSource(value.source)
    && Array.isArray(value.revisions)
    && value.revisions.every(isSourceRevision)
    && Array.isArray(value.ingestionRuns)
    && value.ingestionRuns.every(isSourceIngestionRun)
}

function isKnowledgeSourceUpload(value: unknown): value is KnowledgeSourceUpload {
  return isJsonObject(value) && isKnowledgeSource(value.source) && isSourceRevision(value.revision)
}

function isSourceIngestionLaunch(value: unknown): value is SourceIngestionLaunch {
  return isJsonObject(value)
    && isKnowledgeSource(value.source)
    && isSourceRevision(value.revision)
    && isJsonObject(value.workflow)
    && typeof value.workflow.workflowId === 'string'
    && typeof value.workflow.status === 'string'
    && typeof value.resultContract === 'string'
}

function isOrganizationUnitProjection(value: unknown): value is OrganizationUnitProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.organizationId === 'string'
    && (value.parentId === null || typeof value.parentId === 'string')
    && typeof value.type === 'string'
    && typeof value.slug === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.manager === 'string'
    && typeof value.memberCount === 'number'
}

function isOrganizationMemberProjection(value: unknown): boolean {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.initials === 'string'
    && typeof value.name === 'string'
    && typeof value.role === 'string'
    && typeof value.roleKey === 'string'
    && typeof value.status === 'string'
    && Object.values(OrganizationMembershipStatus).includes(value.status as OrganizationMembershipStatus)
}

function isOrganizationPermissionProjection(value: unknown): value is OrganizationPermissionProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.memberId === 'string'
    && typeof value.unitId === 'string'
    && Object.values(AccessLevel).includes(value.access as AccessLevel)
    && value.propagateToChildren === true
}

function isOrganizationProjection(value: unknown): value is OrganizationProjection {
  if (!isJsonObject(value) || !isJsonObject(value.organization)) return false
  return typeof value.organization.id === 'string'
    && typeof value.organization.slug === 'string'
    && typeof value.organization.name === 'string'
    && Array.isArray(value.units)
    && value.units.every(isOrganizationUnitProjection)
    && Array.isArray(value.members)
    && value.members.every(isOrganizationMemberProjection)
    && Array.isArray(value.permissions)
    && value.permissions.every(isOrganizationPermissionProjection)
}

function parseList<T>(value: unknown, guard: (item: unknown) => item is T, name: string): readonly T[] {
  if (!Array.isArray(value) || !value.every(guard)) throw createApiError(200, `API returned an invalid ${name} response.`, 'INVALID_RESPONSE')
  return value
}

function isAcceptedResponse(value: unknown): value is { accepted: true } {
  return isJsonObject(value) && value.accepted === true
}

function isUpdateResponse(value: unknown): value is { accepted: true; updateId: string } {
  return isJsonObject(value) && value.accepted === true && typeof value.updateId === 'string'
}

async function request<T>(path: string, init?: RequestInit, requiresAuth = true): Promise<T> {
  const session = requiresAuth ? await getAuthSessionToken() : null
  if (requiresAuth && !session) throw createApiError(401, 'Authentication is required.', 'UNAUTHENTICATED')

  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (typeof init?.body === 'string') headers.set('Content-Type', 'application/json')
  if (session) {
    headers.set('Authorization', `Bearer ${session.accessToken}`)
    if (session.organizationId) headers.set('X-Organization-ID', session.organizationId)
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers })
  } catch {
    throw createApiError(0, 'The Gateway API could not be reached.', 'API_UNAVAILABLE')
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const payload = errorPayload(body)
    if (response.status === 401) clearAuthSession()
    throw createApiError(
      response.status,
      payload?.error?.message ?? `API request failed (${response.status})`,
      payload?.error?.code,
    )
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('data' in body)) {
    throw createApiError(response.status, 'API returned an invalid response.', 'INVALID_RESPONSE')
  }
  return (body as ApiEnvelope<T>).data
}

export function listWorkflows(): Promise<readonly WorkflowExecutionProjection[]> {
  return request<unknown>('/workflows').then((value) => parseList(value, isWorkflowProjection, 'workflow list'))
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const value = await request<unknown>('/auth/me')
  if (!isJsonObject(value) || (value.status !== 'active' && value.status !== 'pending')) {
    throw createApiError(200, 'API returned an invalid authentication status.', 'INVALID_RESPONSE')
  }
  if (value.status === 'pending') return { status: 'pending' }
  if (typeof value.userId !== 'string' || typeof value.organizationId !== 'string' || typeof value.canOnboard !== 'boolean' || typeof value.canManageKnowledgeSources !== 'boolean') {
    throw createApiError(200, 'API returned an invalid active authentication status.', 'INVALID_RESPONSE')
  }
  setAuthOrganizationId(value.organizationId, {
    canOnboard: value.canOnboard,
    canManageKnowledgeSources: value.canManageKnowledgeSources,
  })
  return {
    status: 'active',
    userId: value.userId,
    organizationId: value.organizationId,
    canOnboard: value.canOnboard,
    canManageKnowledgeSources: value.canManageKnowledgeSources,
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
  }
}

export function submitWaitlist(input: WaitlistRequest): Promise<WaitlistSubmissionResponse> {
  const validation = validateWaitlistRequest(input)
  if (!validation.ok) {
    return Promise.reject(createApiError(400, validation.issue.message, 'INVALID_REQUEST'))
  }

  return request<unknown>('/public/waitlist', {
    method: 'POST',
    body: JSON.stringify(validation.value),
  }, false).then((value) => {
    if (!isJsonObject(value) || value.accepted !== true) throw createApiError(200, 'API returned an invalid waitlist response.', 'INVALID_RESPONSE')
    return { accepted: true }
  })
}

export async function getWorkflow(workflowId: string): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}`)
  if (!isWorkflowProjection(value)) throw createApiError(200, 'API returned an invalid workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function startWorkflow(input: WorkflowStartRequest): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>('/workflows', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isWorkflowProjection(value)) throw createApiError(200, 'API returned an invalid workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function signalWorkflow(workflowId: string, input: WorkflowSignalRequest): Promise<{ accepted: true }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/signals`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isAcceptedResponse(value)) throw createApiError(200, 'API returned an invalid Signal response.', 'INVALID_RESPONSE')
  return value
}

export async function updateWorkflow(workflowId: string, input: WorkflowUpdateRequest): Promise<{ accepted: true; updateId: string }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/updates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isUpdateResponse(value)) throw createApiError(200, 'API returned an invalid Update response.', 'INVALID_RESPONSE')
  return value
}

export function listIntegrations(): Promise<readonly IntegrationProjection[]> {
  return request<unknown>('/integrations').then((value) => parseList(value, isIntegrationProjection, 'integration list'))
}

export function listKnowledgeSources(): Promise<readonly KnowledgeSource[]> {
  return request<unknown>('/sources').then((value) => parseList(value, isKnowledgeSource, 'Knowledge Source list'))
}

export async function getKnowledgeSource(sourceId: string): Promise<KnowledgeSourceDetail> {
  const value = await request<unknown>(`/sources/${encodeURIComponent(sourceId)}`)
  if (!isKnowledgeSourceDetail(value)) throw createApiError(200, 'API returned an invalid Knowledge Source response.', 'INVALID_RESPONSE')
  return value
}

export async function uploadKnowledgeSourcePdf(file: File, name?: string): Promise<KnowledgeSourceUpload> {
  const form = new FormData()
  form.append('file', file)
  if (name?.trim()) form.append('name', name.trim())
  const value = await request<unknown>('/sources/uploads', { method: 'POST', body: form })
  if (!isKnowledgeSourceUpload(value)) throw createApiError(200, 'API returned an invalid Knowledge Source upload response.', 'INVALID_RESPONSE')
  return value
}

export async function startSourceIngestion(sourceId: string, revisionId: string, trigger: SourceIngestionTrigger = SourceIngestionTrigger.Manual): Promise<SourceIngestionLaunch> {
  const value = await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/revisions/${encodeURIComponent(revisionId)}/ingest`, {
    method: 'POST',
    body: JSON.stringify({ trigger }),
  })
  if (!isSourceIngestionLaunch(value)) throw createApiError(200, 'API returned an invalid source ingestion response.', 'INVALID_RESPONSE')
  return value
}

export async function updateIntegration(integrationId: string, input: IntegrationUpdateRequest): Promise<IntegrationProjection> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isIntegrationProjection(value)) throw createApiError(200, 'API returned an invalid integration response.', 'INVALID_RESPONSE')
  return value
}

export async function getOrganization(): Promise<OrganizationProjection> {
  const value = await request<unknown>('/organization')
  if (!isOrganizationProjection(value)) throw createApiError(200, 'API returned an invalid organization response.', 'INVALID_RESPONSE')
  return value
}

export async function createOrganizationUnit(input: OrganizationUnitCreateRequest): Promise<OrganizationUnitProjection> {
  const value = await request<unknown>('/organization/units', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isOrganizationUnitProjection(value)) throw createApiError(200, 'API returned an invalid organization unit response.', 'INVALID_RESPONSE')
  return value
}

export async function createOrganizationPermission(input: OrganizationPermissionCreateRequest): Promise<OrganizationPermissionProjection> {
  const value = await request<unknown>('/organization/permissions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isOrganizationPermissionProjection(value)) throw createApiError(200, 'API returned an invalid organization permission response.', 'INVALID_RESPONSE')
  return value
}

export async function updateOrganizationPermission(permissionId: string, input: OrganizationPermissionUpdateRequest): Promise<OrganizationPermissionProjection> {
  const value = await request<unknown>(`/organization/permissions/${encodeURIComponent(permissionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  if (!isOrganizationPermissionProjection(value)) throw createApiError(200, 'API returned an invalid organization permission response.', 'INVALID_RESPONSE')
  return value
}

export async function deleteOrganizationPermission(permissionId: string): Promise<void> {
  const value = await request<unknown>(`/organization/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' })
  if (!isJsonObject(value) || value.deleted !== true) throw createApiError(200, 'API returned an invalid organization permission response.', 'INVALID_RESPONSE')
}
