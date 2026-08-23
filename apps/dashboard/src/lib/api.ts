import type {
  AuthStatusResponse,
  IntegrationCreateRequest,
  IntegrationProjection,
  IntegrationAuthorizationStart,
  IntegrationUpdateRequest,
  WebhookEndpointProjection,
  WebhookEndpointSecretResponse,
  OrganizationPermissionCreateRequest,
  OrganizationPermissionProjection,
  OrganizationPermissionUpdateRequest,
  OrganizationAccessRequestCreateRequest,
  OrganizationAccessRequestRecord,
  OrganizationOnboardingProjection,
  OrganizationOnboardingUpdateRequest,
  OrganizationProjection,
  OrganizationUnitCreateRequest,
  OrganizationUnitProjection,
  KnowledgeSource,
  SourceIngestionRun,
  SourceRevision,
  WaitlistRequest,
  WaitlistSubmissionResponse,
  WorkflowExecutionProjection,
  WorkflowEventProjection,
  WorkflowBlueprintProjection,
  WorkflowBlueprintLifecycleRequest,
  WorkflowCreationIntent,
  WorkflowCreationPreview,
  WorkflowRecentActivityProjection,
  WorkflowPlanRecord,
  WorkflowPlannerVersionProjection,
  WorkflowSignalRequest,
  WorkflowStartRequest,
  WorkflowTemplateProjection,
  WorkflowUpdateRequest,
  GraphInspectionProjection,
  GraphInspectionQueryRequest,
  MemoryInspectionProjection,
  MemoryInspectionQueryRequest,
  MemoryChangeRecord,
  MemoryChangeRequest,
  KnowledgeSourceCreateRequest,
  SourceRevisionCreateRequest,
  SavedInvestigation,
  SavedInvestigationCreateRequest,
  NotificationProjection,
  NotificationPreferences,
  RecommendationProjection,
} from '@encois/contracts'
import { AccessLevel, ContractVersion, CoordinationMode, IntegrationStatus, isJsonObject, isPermission, KnowledgeSourceKind, KnowledgeSourceStatus, OrganizationMembershipStatus, OrganizationOnboardingStatus, RecommendationStatus, RecommendationTarget, SourceIngestionTrigger, SourceRevisionStatus, validateWaitlistRequest, WorkflowExecutionStatus, WorkflowStatusReason, WorkflowStepKind } from '@encois/contracts'
import { clearAuthSession, getAuthSessionToken, isDashboardMockMode, setAuthOrganizationId } from '@/lib/auth'

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

function isWorkflowEvent(value: unknown): value is WorkflowEventProjection {
  if (!isJsonObject(value) || typeof value.id !== 'string' || typeof value.eventType !== 'string' || typeof value.status !== 'string' || !isJsonObject(value.metadata) || typeof value.occurredAt !== 'string') return false
  if (value.evidence !== undefined && (!Array.isArray(value.evidence) || value.evidence.some((item) => !isJsonObject(item) || typeof item.reference !== 'string'))) return false
  if (value.trace !== undefined && (!isJsonObject(value.trace) || (value.trace.durationMs !== undefined && typeof value.trace.durationMs !== 'number') || (value.trace.attempt !== undefined && typeof value.trace.attempt !== 'number'))) return false
  return true
}

function isWorkflowTemplate(value: unknown): boolean {
  if (!isJsonObject(value) || value.schemaVersion !== 'workflow-template.v1' || typeof value.version !== 'string' || typeof value.workflowType !== 'string' || typeof value.purpose !== 'string') return false
  if (!isJsonObject(value.inputs) || !Array.isArray(value.providerSlots) || !Array.isArray(value.steps) || !isJsonObject(value.output)) return false
  return typeof value.output.type === 'string' && typeof value.output.description === 'string' && value.steps.every((step) => {
    if (!isJsonObject(step) || typeof step.id !== 'string' || typeof step.kind !== 'string' || !Object.values(WorkflowStepKind).includes(step.kind as WorkflowStepKind)) return false
    if (step.tool !== undefined && typeof step.tool !== 'string') return false
    if (step.agentDefinition !== undefined && typeof step.agentDefinition !== 'string') return false
    if (step.providerSlot !== undefined && typeof step.providerSlot !== 'string') return false
    return true
  })
}

function isWorkflowTemplateProjection(value: unknown): value is WorkflowTemplateProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.key === 'string'
    && typeof value.category === 'string'
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && Array.isArray(value.keywords)
    && value.keywords.every((keyword) => typeof keyword === 'string')
    && Array.isArray(value.requiredCapabilities)
    && value.requiredCapabilities.every((capability) => typeof capability === 'string')
    && typeof value.version === 'string'
    && typeof value.schemaVersion === 'string'
    && isWorkflowTemplate(value.template)
}

function isWorkflowBlueprintProjection(value: unknown): value is WorkflowBlueprintProjection {
  return isJsonObject(value)
    && typeof value.blueprintId === 'string'
    && typeof value.version === 'string'
    && typeof value.name === 'string'
    && typeof value.purpose === 'string'
    && value.workflowType === 'encois.user-blueprint.v1'
    && typeof value.status === 'string'
    && ['draft', 'approved', 'retired'].includes(value.status)
    && typeof value.isCurrent === 'boolean'
    && Array.isArray(value.steps)
    && value.steps.every((step) => isJsonObject(step) && typeof step.id === 'string' && typeof step.kind === 'string')
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function isWorkflowPlanRecord(value: unknown): value is WorkflowPlanRecord {
  return isJsonObject(value)
    && typeof value.planId === 'string'
    && typeof value.organizationId === 'string'
    && typeof value.coordinatorId === 'string'
    && typeof value.status === 'string'
    && ['proposed', 'approved', 'rejected', 'applied', 'expired'].includes(value.status)
    && typeof value.approvalRequired === 'boolean'
    && isJsonObject(value.plan)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function isWorkflowPlannerVersion(value: unknown): value is WorkflowPlannerVersionProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.organizationId === 'string'
    && (value.plannerName === undefined || typeof value.plannerName === 'string')
    && (value.plannerVersion === undefined || typeof value.plannerVersion === 'string')
    && (value.sourceSchemaVersion === undefined || typeof value.sourceSchemaVersion === 'string')
    && (value.promptVersion === undefined || typeof value.promptVersion === 'string')
    && (value.promptHash === undefined || typeof value.promptHash === 'string')
    && typeof value.versionHash === 'string'
    && typeof value.firstPlanId === 'string'
    && typeof value.lastPlanId === 'string'
    && typeof value.usageCount === 'number'
    && typeof value.firstSeenAt === 'string'
    && typeof value.lastSeenAt === 'string'
}

function isWorkflowCreationPreview(value: unknown): value is WorkflowCreationPreview {
  return isJsonObject(value)
    && isJsonObject(value.intent)
    && isJsonObject(value.plan)
    && isJsonObject(value.blueprint)
    && isJsonObject(value.source)
    && typeof value.source.kind === 'string'
    && typeof value.source.title === 'string'
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === 'string')
    && Array.isArray(value.requiredCapabilities)
    && value.requiredCapabilities.every((capability) => typeof capability === 'string')
    && Array.isArray(value.providerBindings)
    && value.providerBindings.every((binding) => isJsonObject(binding) && typeof binding.slotKey === 'string' && typeof binding.required === 'boolean' && typeof binding.status === 'string' && ['ready', 'missing'].includes(binding.status) && Array.isArray(binding.capabilities) && binding.capabilities.every((capability) => typeof capability === 'string'))
    && typeof value.approvalRequired === 'boolean'
}

function isWorkflowActivity(value: unknown): value is WorkflowRecentActivityProjection {
  return isJsonObject(value)
    && isWorkflowEvent(value)
    && typeof (value as Record<string, unknown>).workflowId === 'string'
    && typeof (value as Record<string, unknown>).workflowLabel === 'string'
}

function isIntegrationProjection(value: unknown): value is IntegrationProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.provider === 'string'
    && Object.values(IntegrationStatus).includes(value.status as IntegrationStatus)
}

function isWebhookEndpointProjection(value: unknown): value is WebhookEndpointProjection {
  return isJsonObject(value)
    && typeof value.integrationId === 'string'
    && typeof value.organizationId === 'string'
    && typeof value.endpointKey === 'string'
    && typeof value.provider === 'string'
    && Object.values(IntegrationStatus).includes(value.status as IntegrationStatus)
    && typeof value.secretConfigured === 'boolean'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && (value.url === undefined || typeof value.url === 'string')
}

function isWebhookEndpointSecretResponse(value: unknown): value is WebhookEndpointSecretResponse {
  return isJsonObject(value) && typeof value.secret === 'string' && isWebhookEndpointProjection(value.endpoint)
}

function isIntegrationAuthorizationStart(value: unknown): value is IntegrationAuthorizationStart {
  return isJsonObject(value)
    && typeof value.integrationId === 'string'
    && typeof value.provider === 'string'
    && (value.status === 'redirect' || value.status === 'pending')
    && (value.authorizationUrl === undefined || typeof value.authorizationUrl === 'string')
    && (value.expiresAt === undefined || typeof value.expiresAt === 'string')
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
    && (value.freshness === undefined || (isJsonObject(value.freshness) && typeof value.freshness.source === 'string' && typeof value.freshness.observedAt === 'string' && typeof value.freshness.status === 'string'))
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

function isSavedInvestigation(value: unknown): value is SavedInvestigation {
  return isJsonObject(value) && typeof value.id === 'string' && typeof value.organizationId === 'string' && typeof value.name === 'string' && ['graph', 'memory', 'workflow'].includes(value.kind as string) && typeof value.query === 'string' && isJsonObject(value.params) && isJsonObject(value.scope) && Array.isArray(value.scope.ids) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
}

function isNotification(value: unknown): value is NotificationProjection {
  return isJsonObject(value) && typeof value.id === 'string' && typeof value.type === 'string' && ['info', 'warning', 'error'].includes(value.severity as string) && typeof value.title === 'string' && typeof value.message === 'string' && typeof value.createdAt === 'string'
}

function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  return isJsonObject(value) && ['emailEnabled', 'pushEnabled', 'workflowUpdates', 'evidenceReady', 'weeklyDigest'].every((key) => typeof value[key] === 'boolean')
}

function isRecommendation(value: unknown): value is RecommendationProjection {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.organizationId === 'string'
    && typeof value.recommendationKey === 'string'
    && typeof value.kind === 'string'
    && ['info', 'attention'].includes(value.severity as string)
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && Object.values(RecommendationTarget).includes(value.target as RecommendationProjection['target'])
    && typeof value.actionLabel === 'string'
    && Object.values(RecommendationStatus).includes(value.status as RecommendationProjection['status'])
    && isJsonObject(value.scope)
    && Array.isArray(value.scope.ids)
    && isJsonObject(value.metadata)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.observedAt === 'string'
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

function isOrganizationOnboardingProjection(value: unknown): value is OrganizationOnboardingProjection {
  return isJsonObject(value)
    && typeof value.organizationId === 'string'
    && typeof value.coordinatorId === 'string'
    && typeof value.status === 'string'
    && Object.values(OrganizationOnboardingStatus).includes(value.status as OrganizationOnboardingStatus)
    && typeof value.coordinationMode === 'string'
    && Object.values(CoordinationMode).includes(value.coordinationMode as CoordinationMode)
    && Array.isArray(value.selectedWorkflows)
    && value.selectedWorkflows.every((item) => typeof item === 'string')
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && (value.lastError === undefined || typeof value.lastError === 'string')
}

function isOrganizationAccessRequestRecord(value: unknown): value is OrganizationAccessRequestRecord {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.organizationId === 'string'
    && typeof value.requestedByUserId === 'string'
    && typeof value.requesterName === 'string'
    && typeof value.unitId === 'string'
    && typeof value.unitName === 'string'
    && ['viewer', 'contributor', 'manager'].includes(value.access as string)
    && typeof value.reason === 'string'
    && ['proposed', 'approved', 'rejected', 'applied'].includes(value.status as string)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
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
    && isOrganizationOnboardingProjection(value.onboarding)
}

function isGraphInspectionProjection(value: unknown): value is GraphInspectionProjection {
  return isJsonObject(value)
    && typeof value.query === 'string'
    && ['all', 'all_context', 'source.facts', 'project.related_entities', 'release.blockers'].includes(value.query)
    && typeof value.status === 'string'
    && ['completed', 'deferred', 'failed'].includes(value.status)
    && Array.isArray(value.nodes)
    && value.nodes.every((node) => isJsonObject(node) && typeof node.id === 'string' && typeof node.type === 'string' && isJsonObject(node.properties))
    && Array.isArray(value.edges)
    && value.edges.every((edge) => isJsonObject(edge) && typeof edge.id === 'string' && typeof edge.sourceId === 'string' && typeof edge.targetId === 'string' && typeof edge.relationship === 'string' && isJsonObject(edge.properties))
    && (value.evidenceRefs === undefined || (Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((ref) => typeof ref === 'string')))
    && typeof value.generatedAt === 'string'
}

function isMemoryInspectionProjection(value: unknown): value is MemoryInspectionProjection {
  return isJsonObject(value)
    && typeof value.agentDefinition === 'string'
    && typeof value.query === 'string'
    && isJsonObject(value.scope)
    && Array.isArray(value.scope.ids)
    && value.scope.ids.every((id) => typeof id === 'string')
    && typeof value.status === 'string'
    && ['completed', 'deferred', 'failed'].includes(value.status)
    && Array.isArray(value.memories)
    && value.memories.every((memory) => isJsonObject(memory) && typeof memory.id === 'string' && typeof memory.agentDefinition === 'string' && typeof memory.summary === 'string' && Array.isArray(memory.evidenceRefs) && memory.evidenceRefs.every((ref) => typeof ref === 'string') && typeof memory.observedAt === 'string')
    && typeof value.generatedAt === 'string'
}

function isMemoryChangeRecord(value: unknown): value is MemoryChangeRecord {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.organizationId === 'string'
    && (value.memoryId === undefined || typeof value.memoryId === 'string')
    && typeof value.agentDefinition === 'string'
    && isJsonObject(value.scope)
    && Array.isArray(value.scope.ids)
    && value.scope.ids.every((id) => typeof id === 'string')
    && ['add', 'correct', 'delete'].includes(value.action as string)
    && (value.evidenceRefs === undefined || (Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((ref) => typeof ref === 'string')))
    && ['proposed', 'approved', 'rejected', 'applied', 'failed'].includes(value.status as string)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function parseList<T>(value: unknown, guard: (item: unknown) => item is T, name: string): readonly T[] {
  if (!Array.isArray(value) || !value.every(guard)) throw createApiError(200, `The service returned an invalid ${name} response.`, 'INVALID_RESPONSE')
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
    throw createApiError(0, 'Encois could not be reached.', 'API_UNAVAILABLE')
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const payload = errorPayload(body)
    // The local UI fixture intentionally runs without an API process. Keep
    // its development session intact so route-level mock flows can still be
    // reviewed; hosted/API-backed sessions must be invalidated on 401.
    if (response.status === 401 && !isDashboardMockMode()) clearAuthSession()
    throw createApiError(
      response.status,
      payload?.error?.message ?? `API request failed (${response.status})`,
      payload?.error?.code,
    )
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('data' in body)) {
    throw createApiError(response.status, 'The service returned an invalid response.', 'INVALID_RESPONSE')
  }
  return (body as ApiEnvelope<T>).data
}

export function listWorkflows(): Promise<readonly WorkflowExecutionProjection[]> {
  return request<unknown>('/workflows').then((value) => parseList(value, isWorkflowProjection, 'workflow list'))
}

export function listWorkflowTemplates(input: { query?: string; category?: string } = {}): Promise<readonly WorkflowTemplateProjection[]> {
  const params = new URLSearchParams()
  if (input.query?.trim()) params.set('q', input.query.trim())
  if (input.category?.trim()) params.set('category', input.category.trim())
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return request<unknown>(`/workflows/templates${query}`).then((value) => parseList(value, isWorkflowTemplateProjection, 'workflow template list'))
}

export function listWorkflowBlueprints(): Promise<readonly WorkflowBlueprintProjection[]> {
  return request<unknown>('/workflows/blueprints').then((value) => parseList(value, isWorkflowBlueprintProjection, 'workflow Blueprint list'))
}

export async function createBlueprintLifecyclePlan(blueprintId: string, input: Omit<WorkflowBlueprintLifecycleRequest, 'contractVersion'>): Promise<WorkflowPlanRecord> {
  const value = await request<unknown>(`/workflows/blueprints/${encodeURIComponent(blueprintId)}/lifecycle`, {
    method: 'POST',
    body: JSON.stringify({ contractVersion: ContractVersion.WorkflowBlueprintLifecycle, ...input }),
  })
  if (!isWorkflowPlanRecord(value)) throw createApiError(200, 'The service returned an invalid Blueprint lifecycle plan.', 'INVALID_RESPONSE')
  return value
}

export async function previewWorkflowCreation(input: WorkflowCreationIntent): Promise<WorkflowCreationPreview> {
  const value = await request<unknown>('/workflows/plans/preview', { method: 'POST', body: JSON.stringify(input) })
  if (!isWorkflowCreationPreview(value)) throw createApiError(200, 'The service returned an invalid workflow creation preview.', 'INVALID_RESPONSE')
  return value
}

export async function submitWorkflowCreation(input: WorkflowCreationIntent): Promise<WorkflowPlanRecord> {
  const value = await request<unknown>('/workflows/plans/from-intent', { method: 'POST', body: JSON.stringify(input) })
  if (!isWorkflowPlanRecord(value)) throw createApiError(200, 'The service returned an invalid workflow plan.', 'INVALID_RESPONSE')
  return value
}

export function listWorkflowPlans(limit = 100): Promise<readonly WorkflowPlanRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100))
  return request<unknown>(`/workflows/plans?limit=${boundedLimit}`).then((value) => parseList(value, isWorkflowPlanRecord, 'workflow plan list'))
}

export function listWorkflowPlannerVersions(limit = 100): Promise<readonly WorkflowPlannerVersionProjection[]> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100))
  return request<unknown>(`/workflows/planner-versions?limit=${boundedLimit}`).then((value) => parseList(value, isWorkflowPlannerVersion, 'workflow planner version list'))
}

export async function approveWorkflowPlan(planId: string): Promise<WorkflowPlanRecord> {
  const value = await request<unknown>(`/workflows/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST' })
  if (!isWorkflowPlanRecord(value)) throw createApiError(200, 'The service returned an invalid approved workflow plan.', 'INVALID_RESPONSE')
  return value
}

export async function applyWorkflowPlan(planId: string): Promise<WorkflowPlanRecord> {
  const value = await request<unknown>(`/workflows/plans/${encodeURIComponent(planId)}/apply`, { method: 'POST' })
  if (!isWorkflowPlanRecord(value)) throw createApiError(200, 'The service returned an invalid applied workflow plan.', 'INVALID_RESPONSE')
  return value
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const value = await request<unknown>('/auth/me')
  if (!isJsonObject(value) || (value.status !== 'active' && value.status !== 'pending')) {
    throw createApiError(200, 'The service returned an invalid authentication status.', 'INVALID_RESPONSE')
  }
  if (value.status === 'pending') return { status: 'pending' }
  if (typeof value.userId !== 'string' || typeof value.organizationId !== 'string' || !Array.isArray(value.permissions) || !value.permissions.every(isPermission)) {
    throw createApiError(200, 'The service returned an invalid active authentication status.', 'INVALID_RESPONSE')
  }
  setAuthOrganizationId(value.organizationId, value.permissions, value.userId)
  return {
    status: 'active',
    userId: value.userId,
    organizationId: value.organizationId,
    permissions: value.permissions,
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
    if (!isJsonObject(value) || value.accepted !== true) throw createApiError(200, 'The service returned an invalid waitlist response.', 'INVALID_RESPONSE')
    return { accepted: true }
  })
}

export async function getWorkflow(workflowId: string): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}`)
  if (!isWorkflowProjection(value)) throw createApiError(200, 'The service returned an invalid workflow response.', 'INVALID_RESPONSE')
  return value
}

export function getWorkflowEvents(workflowId: string): Promise<readonly WorkflowEventProjection[]> {
  return request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/events`).then((value) => parseList(value, isWorkflowEvent, 'workflow event list'))
}

export function listWorkflowActivity(): Promise<readonly WorkflowRecentActivityProjection[]> {
  return request<unknown>('/workflows/activity').then((value) => parseList(value, isWorkflowActivity, 'workflow activity list'))
}

export async function startWorkflow(input: WorkflowStartRequest): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>('/workflows', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isWorkflowProjection(value)) throw createApiError(200, 'The service returned an invalid workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function signalWorkflow(workflowId: string, input: WorkflowSignalRequest): Promise<{ accepted: true }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/signals`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isAcceptedResponse(value)) throw createApiError(200, 'The service returned an invalid Signal response.', 'INVALID_RESPONSE')
  return value
}

export async function cancelWorkflow(workflowId: string): Promise<{ accepted: true }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/cancel`, { method: 'POST' })
  if (!isAcceptedResponse(value)) throw createApiError(200, 'The service returned an invalid cancellation response.', 'INVALID_RESPONSE')
  return value
}

export async function rerunWorkflow(workflowId: string): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/rerun`, { method: 'POST' })
  if (!isWorkflowProjection(value)) throw createApiError(200, 'The service returned an invalid rerun workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function retryWorkflow(workflowId: string): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/retry`, { method: 'POST' })
  if (!isWorkflowProjection(value)) throw createApiError(200, 'The service returned an invalid retry workflow response.', 'INVALID_RESPONSE')
  return value
}

export async function updateWorkflow(workflowId: string, input: WorkflowUpdateRequest): Promise<{ accepted: true; updateId: string }> {
  const value = await request<unknown>(`/workflows/${encodeURIComponent(workflowId)}/updates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isUpdateResponse(value)) throw createApiError(200, 'The service returned an invalid Update response.', 'INVALID_RESPONSE')
  return value
}

export function listIntegrations(): Promise<readonly IntegrationProjection[]> {
  return request<unknown>('/integrations').then((value) => parseList(value, isIntegrationProjection, 'integration list'))
}

export async function createIntegration(input: IntegrationCreateRequest): Promise<IntegrationProjection> {
  const value = await request<unknown>('/integrations', { method: 'POST', body: JSON.stringify(input) })
  if (!isIntegrationProjection(value)) throw createApiError(200, 'The service returned an invalid integration response.', 'INVALID_RESPONSE')
  return value
}

export function listKnowledgeSources(): Promise<readonly KnowledgeSource[]> {
  return request<unknown>('/sources').then((value) => parseList(value, isKnowledgeSource, 'Knowledge Source list'))
}

export async function createKnowledgeSource(input: KnowledgeSourceCreateRequest): Promise<KnowledgeSource> {
  const value = await request<unknown>('/sources', { method: 'POST', body: JSON.stringify(input) })
  if (!isKnowledgeSource(value)) throw createApiError(200, 'The service returned an invalid Knowledge Source response.', 'INVALID_RESPONSE')
  return value
}

export async function getKnowledgeSource(sourceId: string): Promise<KnowledgeSourceDetail> {
  const value = await request<unknown>(`/sources/${encodeURIComponent(sourceId)}`)
  if (!isKnowledgeSourceDetail(value)) throw createApiError(200, 'The service returned an invalid Knowledge Source response.', 'INVALID_RESPONSE')
  return value
}

export async function createSourceRevision(sourceId: string, input: SourceRevisionCreateRequest): Promise<SourceRevision> {
  const value = await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/revisions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isSourceRevision(value)) throw createApiError(200, 'The service returned an invalid source revision response.', 'INVALID_RESPONSE')
  return value
}

export async function uploadKnowledgeSourcePdf(file: File, name?: string, scopes?: Pick<KnowledgeSourceCreateRequest, 'readScope' | 'visibilityScope'>): Promise<KnowledgeSourceUpload> {
  const form = new FormData()
  form.append('file', file)
  if (name?.trim()) form.append('name', name.trim())
  if (scopes?.readScope) form.append('readScope', JSON.stringify(scopes.readScope))
  if (scopes?.visibilityScope) form.append('visibilityScope', JSON.stringify(scopes.visibilityScope))
  const value = await request<unknown>('/sources/uploads', { method: 'POST', body: form })
  if (!isKnowledgeSourceUpload(value)) throw createApiError(200, 'The service returned an invalid Knowledge Source upload response.', 'INVALID_RESPONSE')
  return value
}

export async function startSourceIngestion(sourceId: string, revisionId: string, trigger: SourceIngestionTrigger = SourceIngestionTrigger.Manual): Promise<SourceIngestionLaunch> {
  const value = await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/revisions/${encodeURIComponent(revisionId)}/ingest`, {
    method: 'POST',
    body: JSON.stringify({ trigger }),
  })
  if (!isSourceIngestionLaunch(value)) throw createApiError(200, 'The service returned an invalid source ingestion response.', 'INVALID_RESPONSE')
  return value
}

export async function updateIntegration(integrationId: string, input: IntegrationUpdateRequest): Promise<IntegrationProjection> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isIntegrationProjection(value)) throw createApiError(200, 'The service returned an invalid integration response.', 'INVALID_RESPONSE')
  return value
}

export async function getWebhookEndpoint(integrationId: string): Promise<WebhookEndpointProjection | null> {
  let value: unknown
  try {
    value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}/webhook`)
  } catch (error) {
    if (isApiError(error) && error.code === 'WEBHOOK_ENDPOINT_NOT_FOUND') return null
    throw error
  }
  if (!isWebhookEndpointProjection(value)) throw createApiError(200, 'The service returned an invalid webhook endpoint response.', 'INVALID_RESPONSE')
  return value
}

export async function provisionWebhookEndpoint(integrationId: string, endpointKey?: string): Promise<WebhookEndpointSecretResponse> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}/webhook`, {
    method: 'POST',
    body: JSON.stringify(endpointKey ? { endpointKey } : {}),
  })
  if (!isWebhookEndpointSecretResponse(value)) throw createApiError(200, 'The service returned an invalid webhook provisioning response.', 'INVALID_RESPONSE')
  return value
}

export async function rotateWebhookEndpoint(integrationId: string): Promise<WebhookEndpointSecretResponse> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}/webhook/rotate`, { method: 'POST' })
  if (!isWebhookEndpointSecretResponse(value)) throw createApiError(200, 'The service returned an invalid webhook rotation response.', 'INVALID_RESPONSE')
  return value
}

export async function setWebhookEndpointStatus(integrationId: string, status: 'active' | 'disabled'): Promise<WebhookEndpointProjection> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}/webhook/${status === 'active' ? 'enable' : 'disable'}`, { method: 'POST' })
  if (!isWebhookEndpointProjection(value)) throw createApiError(200, 'The service returned an invalid webhook status response.', 'INVALID_RESPONSE')
  return value
}

export async function startIntegrationAuthorization(integrationId: string): Promise<IntegrationAuthorizationStart> {
  const value = await request<unknown>(`/integrations/${encodeURIComponent(integrationId)}/authorization/start`, { method: 'POST' })
  if (!isIntegrationAuthorizationStart(value)) throw createApiError(200, 'The service returned an invalid authorization response.', 'INVALID_RESPONSE')
  return value
}

export async function getOrganization(): Promise<OrganizationProjection> {
  const value = await request<unknown>('/organization')
  if (!isOrganizationProjection(value)) throw createApiError(200, 'The service returned an invalid organization response.', 'INVALID_RESPONSE')
  return value
}

export async function updateOrganizationOnboarding(input: OrganizationOnboardingUpdateRequest): Promise<OrganizationOnboardingProjection> {
  const value = await request<unknown>('/organization/onboarding', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  if (!isOrganizationOnboardingProjection(value)) throw createApiError(200, 'The service returned an invalid onboarding response.', 'INVALID_RESPONSE')
  return value
}

export async function startOrganizationOnboarding(): Promise<OrganizationOnboardingProjection> {
  const value = await request<unknown>('/organization/onboarding/start', { method: 'POST' })
  if (!isOrganizationOnboardingProjection(value)) throw createApiError(200, 'The service returned an invalid onboarding response.', 'INVALID_RESPONSE')
  return value
}

export async function createOrganizationUnit(input: OrganizationUnitCreateRequest): Promise<OrganizationUnitProjection> {
  const value = await request<unknown>('/organization/units', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isOrganizationUnitProjection(value)) throw createApiError(200, 'The service returned an invalid organization unit response.', 'INVALID_RESPONSE')
  return value
}

export async function createOrganizationPermission(input: OrganizationPermissionCreateRequest): Promise<OrganizationPermissionProjection> {
  const value = await request<unknown>('/organization/permissions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!isOrganizationPermissionProjection(value)) throw createApiError(200, 'The service returned an invalid organization permission response.', 'INVALID_RESPONSE')
  return value
}

export async function updateOrganizationPermission(permissionId: string, input: OrganizationPermissionUpdateRequest): Promise<OrganizationPermissionProjection> {
  const value = await request<unknown>(`/organization/permissions/${encodeURIComponent(permissionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  if (!isOrganizationPermissionProjection(value)) throw createApiError(200, 'The service returned an invalid organization permission response.', 'INVALID_RESPONSE')
  return value
}

export async function deleteOrganizationPermission(permissionId: string): Promise<void> {
  const value = await request<unknown>(`/organization/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' })
  if (!isJsonObject(value) || value.deleted !== true) throw createApiError(200, 'The service returned an invalid organization permission response.', 'INVALID_RESPONSE')
}

export function listOrganizationAccessRequests(): Promise<readonly OrganizationAccessRequestRecord[]> {
  return request<unknown>('/organization/access-requests').then((value) => parseList(value, isOrganizationAccessRequestRecord, 'organization access request list'))
}

export async function createOrganizationAccessRequest(input: OrganizationAccessRequestCreateRequest): Promise<OrganizationAccessRequestRecord> {
  const value = await request<unknown>('/organization/access-requests', { method: 'POST', body: JSON.stringify(input) })
  if (!isOrganizationAccessRequestRecord(value)) throw createApiError(200, 'The service returned an invalid access request response.', 'INVALID_RESPONSE')
  return value
}

async function decideOrganizationAccessRequest(requestId: string, action: 'approve' | 'reject' | 'apply'): Promise<OrganizationAccessRequestRecord> {
  const value = await request<unknown>(`/organization/access-requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST' })
  if (!isOrganizationAccessRequestRecord(value)) throw createApiError(200, 'The service returned an invalid access request response.', 'INVALID_RESPONSE')
  return value
}

export function approveOrganizationAccessRequest(requestId: string): Promise<OrganizationAccessRequestRecord> {
  return decideOrganizationAccessRequest(requestId, 'approve')
}

export function rejectOrganizationAccessRequest(requestId: string): Promise<OrganizationAccessRequestRecord> {
  return decideOrganizationAccessRequest(requestId, 'reject')
}

export function applyOrganizationAccessRequest(requestId: string): Promise<OrganizationAccessRequestRecord> {
  return decideOrganizationAccessRequest(requestId, 'apply')
}

export async function queryContextGraph(input: GraphInspectionQueryRequest): Promise<GraphInspectionProjection> {
  const value = await request<unknown>('/context/graph/query', { method: 'POST', body: JSON.stringify(input) })
  if (!isGraphInspectionProjection(value)) throw createApiError(200, 'The service returned an invalid context graph response.', 'INVALID_RESPONSE')
  return value
}

export async function queryAgentMemory(input: MemoryInspectionQueryRequest): Promise<MemoryInspectionProjection> {
  const value = await request<unknown>('/context/memory/query', { method: 'POST', body: JSON.stringify(input) })
  if (!isMemoryInspectionProjection(value)) throw createApiError(200, 'The service returned an invalid agent memory response.', 'INVALID_RESPONSE')
  return value
}

export function listMemoryChanges(limit = 100): Promise<readonly MemoryChangeRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100))
  return request<unknown>(`/context/memory/changes?limit=${boundedLimit}`).then((value) => parseList(value, isMemoryChangeRecord, 'memory change list'))
}

export async function createMemoryChange(input: MemoryChangeRequest): Promise<MemoryChangeRecord> {
  const value = await request<unknown>('/context/memory/changes', { method: 'POST', body: JSON.stringify(input) })
  if (!isMemoryChangeRecord(value)) throw createApiError(200, 'The service returned an invalid memory change response.', 'INVALID_RESPONSE')
  return value
}

async function decideMemoryChange(changeId: string, action: 'approve' | 'reject' | 'apply'): Promise<MemoryChangeRecord> {
  const value = await request<unknown>(`/context/memory/changes/${encodeURIComponent(changeId)}/${action}`, { method: 'POST' })
  if (!isMemoryChangeRecord(value)) throw createApiError(200, 'The service returned an invalid memory change response.', 'INVALID_RESPONSE')
  return value
}

export function approveMemoryChange(changeId: string): Promise<MemoryChangeRecord> {
  return decideMemoryChange(changeId, 'approve')
}

export function rejectMemoryChange(changeId: string): Promise<MemoryChangeRecord> {
  return decideMemoryChange(changeId, 'reject')
}

export function applyMemoryChange(changeId: string): Promise<MemoryChangeRecord> {
  return decideMemoryChange(changeId, 'apply')
}

export function listSavedInvestigations(): Promise<readonly SavedInvestigation[]> {
  return request<unknown>('/investigations').then((value) => parseList(value, isSavedInvestigation, 'saved investigation list'))
}

export async function createSavedInvestigation(input: SavedInvestigationCreateRequest): Promise<SavedInvestigation> {
  const value = await request<unknown>('/investigations', { method: 'POST', body: JSON.stringify(input) })
  if (!isSavedInvestigation(value)) throw createApiError(200, 'The service returned an invalid saved investigation response.', 'INVALID_RESPONSE')
  return value
}

export async function deleteSavedInvestigation(investigationId: string): Promise<{ deleted: true }> {
  const value = await request<unknown>(`/investigations/${encodeURIComponent(investigationId)}`, { method: 'DELETE' })
  if (!isJsonObject(value) || value.deleted !== true) throw createApiError(200, 'The service returned an invalid saved investigation response.', 'INVALID_RESPONSE')
  return { deleted: true }
}

export function listNotifications(): Promise<readonly NotificationProjection[]> {
  return request<unknown>('/notifications').then((value) => parseList(value, isNotification, 'notification list'))
}

export function listRecommendations(): Promise<readonly RecommendationProjection[]> {
  return request<unknown>('/investigations/recommendations').then((value) => parseList(value, isRecommendation, 'recommendation list'))
}

export async function updateRecommendation(recommendationId: string, action: 'accept' | 'dismiss'): Promise<RecommendationProjection> {
  const value = await request<unknown>(`/investigations/recommendations/${encodeURIComponent(recommendationId)}/${action}`, { method: 'POST' })
  if (!isRecommendation(value)) throw createApiError(200, 'The service returned an invalid recommendation response.', 'INVALID_RESPONSE')
  return value
}

export async function markNotificationRead(notificationId: string): Promise<{ read: true }> {
  const value = await request<unknown>(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' })
  if (!isJsonObject(value) || value.read !== true) throw createApiError(200, 'The service returned an invalid notification response.', 'INVALID_RESPONSE')
  return { read: true }
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const value = await request<unknown>('/settings/notifications')
  if (!isNotificationPreferences(value)) throw createApiError(200, 'The service returned invalid notification preferences.', 'INVALID_RESPONSE')
  return value
}

export async function updateNotificationPreferences(input: NotificationPreferences): Promise<NotificationPreferences> {
  const value = await request<unknown>('/settings/notifications', { method: 'PUT', body: JSON.stringify(input) })
  if (!isNotificationPreferences(value)) throw createApiError(200, 'The service returned invalid notification preferences.', 'INVALID_RESPONSE')
  return value
}
