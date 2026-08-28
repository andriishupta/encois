import type {
  AuthStatusResponse,
  GraphInspectionProjection,
  GraphInspectionQueryRequest,
  IntegrationAuthorizationStart,
  IntegrationCatalogProjection,
  IntegrationCreateRequest,
  IntegrationProjection,
  IntegrationUpdateRequest,
  KnowledgeSource,
  KnowledgeSourceCreateRequest,
  MemoryChangeRecord,
  MemoryChangeRequest,
  MemoryInspectionProjection,
  MemoryInspectionQueryRequest,
  NotificationPreferences,
  NotificationProjection,
  OrganizationAccessRequestCreateRequest,
  OrganizationAccessRequestRecord,
  OrganizationOnboardingProjection,
  OrganizationOnboardingUpdateRequest,
  OrganizationPermissionCreateRequest,
  OrganizationPermissionProjection,
  OrganizationPermissionUpdateRequest,
  OrganizationProjection,
  OrganizationUnitCreateRequest,
  OrganizationUnitProjection,
  RecommendationProjection,
  SavedInvestigation,
  SavedInvestigationCreateRequest,
  SourceRevision,
  SourceRevisionCreateRequest,
  WaitlistRequest,
  WaitlistSubmissionResponse,
  WebhookEndpointProjection,
  WebhookEndpointSecretResponse,
  WorkflowBlueprintProjection,
  WorkflowCreationIntent,
  WorkflowCreationPreview,
  WorkflowCreationResult,
  WorkflowEventProjection,
  WorkflowExecutionProjection,
  WorkflowRecentActivityProjection,
  WorkflowSignalRequest,
  WorkflowStartRequest,
  WorkflowTemplateProjection,
  WorkflowUpdateRequest,
} from "@encois/contracts/browser";
import {
  type IntegrationType,
  isJsonObject,
  isPermission,
  SourceIngestionTrigger,
  validateWaitlistRequest,
} from "@encois/contracts/browser";
import {
  apiBaseUrl,
  createApiError,
  DEFAULT_LIST_LIMIT,
  errorPayload,
  getSafeAuthSessionToken,
  isApiError,
  type ListPage,
  type ListQueryInput,
  listQuery,
  parseList,
  request,
  requestList,
} from "@/lib/api-client";
import { clearAuthSession, setAuthOrganizationId } from "@/lib/auth";

export {
  type ApiError,
  createApiError,
  isApiError,
  type ListPage,
  type ListQueryInput,
} from "@/lib/api-client";

import {
  isAcceptedResponse,
  isGraphInspectionProjection,
  isIntegrationAuthorizationStart,
  isIntegrationCatalogProjection,
  isIntegrationProjection,
  isKnowledgeSource,
  isKnowledgeSourceDetail,
  isKnowledgeSourceUpload,
  isMemoryChangeRecord,
  isMemoryInspectionProjection,
  isNotification,
  isNotificationPreferences,
  isOrganizationAccessRequestRecord,
  isOrganizationOnboardingProjection,
  isOrganizationPermissionProjection,
  isOrganizationProjection,
  isOrganizationUnitProjection,
  isRecommendation,
  isSavedInvestigation,
  isSourceIngestionLaunch,
  isSourceRevision,
  isUpdateResponse,
  isWebhookEndpointProjection,
  isWebhookEndpointSecretResponse,
  isWorkflowActivity,
  isWorkflowBlueprintProjection,
  isWorkflowCreationPreview,
  isWorkflowCreationResult,
  isWorkflowEvent,
  isWorkflowProjection,
  isWorkflowTemplateProjection,
  type KnowledgeSourceDetail,
  type KnowledgeSourceUpload,
  type SourceIngestionLaunch,
} from "@/lib/api-validation";

export type {
  KnowledgeSourceDetail,
  KnowledgeSourceUpload,
  SourceIngestionLaunch,
} from "@/lib/api-validation";
export async function downloadSourceRevisionRaw(
  sourceId: string,
  revisionId: string,
): Promise<{ blob: Blob; fileName: string }> {
  let session = await getSafeAuthSessionToken();
  if (!session) {
    clearAuthSession();
    throw createApiError(401, "Authentication is required.", "UNAUTHENTICATED");
  }

  const path = `/sources/${encodeURIComponent(sourceId)}/revisions/${encodeURIComponent(revisionId)}/raw`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = new Headers({ Accept: "application/octet-stream" });
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    if (session.organizationId)
      headers.set("X-Organization-ID", session.organizationId);

    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, { headers });
    } catch {
      throw createApiError(
        0,
        "The workspace could not be reached.",
        "API_UNAVAILABLE",
      );
    }

    if (response.status === 401 && attempt === 0) {
      const refreshed = await getSafeAuthSessionToken(true);
      if (refreshed) {
        session = refreshed;
        continue;
      }
    }

    if (!response.ok) {
      const payload = errorPayload(await response.json().catch(() => null));
      if (response.status === 401) clearAuthSession();
      throw createApiError(
        response.status,
        payload?.error?.message ?? `API request failed (${response.status})`,
        payload?.error?.code,
        {
          requestId: payload?.error?.requestId,
          traceId: payload?.error?.traceId,
        },
      );
    }

    const contentDisposition = response.headers.get("Content-Disposition");
    const encodedFileName = contentDisposition?.match(
      /filename\*=UTF-8''([^;]+)/i,
    )?.[1];
    const quotedFileName =
      contentDisposition?.match(/filename="([^"]+)"/i)?.[1];
    const fileName = encodedFileName
      ? decodeURIComponent(encodedFileName)
      : (quotedFileName ?? `source-revision-${revisionId}.pdf`);
    return { blob: await response.blob(), fileName };
  }

  clearAuthSession();
  throw createApiError(401, "Authentication is required.", "UNAUTHENTICATED");
}

export function listWorkflows(
  input: ListQueryInput = {},
): Promise<readonly WorkflowExecutionProjection[]> {
  return request<unknown>(
    `/workflows${listQuery({
      ...input,
      limit: input.limit ?? DEFAULT_LIST_LIMIT,
    })}`,
  ).then((value) => parseList(value, isWorkflowProjection, "workflow list"));
}

export function listWorkflowsPage(
  input: ListQueryInput = {},
): Promise<ListPage<WorkflowExecutionProjection>> {
  return requestList(
    `/workflows${listQuery(input)}`,
    isWorkflowProjection,
    "workflow list",
  );
}

export function listWorkflowTemplates(
  input: ListQueryInput & { category?: string } = {},
): Promise<readonly WorkflowTemplateProjection[]> {
  return listWorkflowTemplatesPage({
    ...input,
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
  }).then((page) => page.items);
}

export function listWorkflowTemplatesPage(
  input: ListQueryInput & { category?: string } = {},
): Promise<ListPage<WorkflowTemplateProjection>> {
  const params = new URLSearchParams(listQuery(input).replace(/^\?/u, ""));
  if (input.category?.trim()) params.set("category", input.category.trim());
  return requestList(
    `/workflows/templates${params.size ? `?${params.toString()}` : ""}`,
    isWorkflowTemplateProjection,
    "workflow template list",
  );
}

export function listWorkflowBlueprints(
  input: ListQueryInput = {},
): Promise<readonly WorkflowBlueprintProjection[]> {
  return listWorkflowBlueprintsPage({
    ...input,
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
  }).then((page) => page.items);
}

export function listWorkflowBlueprintsPage(
  input: ListQueryInput = {},
): Promise<ListPage<WorkflowBlueprintProjection>> {
  return requestList(
    `/workflows/blueprints${listQuery(input)}`,
    isWorkflowBlueprintProjection,
    "workflow Blueprint list",
  );
}

export async function deleteWorkflowBlueprint(
  blueprintId: string,
  version: string,
): Promise<void> {
  const value = await request<unknown>(
    `/workflows/blueprints/${encodeURIComponent(blueprintId)}/${encodeURIComponent(version)}`,
    { method: "DELETE" },
  );
  if (!isJsonObject(value) || value.deleted !== true)
    throw createApiError(
      200,
      "The service returned an invalid Blueprint deletion response.",
      "INVALID_RESPONSE",
    );
}

export async function deleteWorkflowDefinition(
  workflowId: string,
): Promise<void> {
  const value = await request<unknown>(
    `/workflows/definitions/${encodeURIComponent(workflowId)}`,
    { method: "DELETE" },
  );
  if (!isJsonObject(value) || value.deleted !== true)
    throw createApiError(
      200,
      "The service returned an invalid Workflow deletion response.",
      "INVALID_RESPONSE",
    );
}

export async function previewWorkflowCreation(
  input: WorkflowCreationIntent,
): Promise<WorkflowCreationPreview> {
  const value = await request<unknown>("/workflows/blueprints/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isWorkflowCreationPreview(value))
    throw createApiError(
      200,
      "The service returned an invalid workflow creation preview.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function submitWorkflowCreation(
  input: WorkflowCreationIntent,
): Promise<WorkflowCreationResult> {
  const value = await request<unknown>("/workflows/blueprints/from-intent", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isWorkflowCreationResult(value))
    throw createApiError(
      200,
      "The service returned an invalid workflow creation result.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const value = await request<unknown>("/auth/me");
  if (
    !isJsonObject(value) ||
    (value.status !== "active" && value.status !== "pending")
  ) {
    throw createApiError(
      200,
      "The service returned an invalid authentication status.",
      "INVALID_RESPONSE",
    );
  }
  if (value.status === "pending") return { status: "pending" };
  if (
    typeof value.userId !== "string" ||
    typeof value.organizationId !== "string" ||
    !Array.isArray(value.permissions) ||
    !value.permissions.every(isPermission)
  ) {
    throw createApiError(
      200,
      "The service returned an invalid active authentication status.",
      "INVALID_RESPONSE",
    );
  }
  setAuthOrganizationId(value.organizationId, value.permissions, value.userId);
  return {
    status: "active",
    userId: value.userId,
    organizationId: value.organizationId,
    permissions: value.permissions,
    ...(typeof value.displayName === "string"
      ? { displayName: value.displayName }
      : {}),
  };
}

export function submitWaitlist(
  input: WaitlistRequest,
): Promise<WaitlistSubmissionResponse> {
  const validation = validateWaitlistRequest(input);
  if (!validation.ok) {
    return Promise.reject(
      createApiError(400, validation.issue.message, "INVALID_REQUEST"),
    );
  }

  return request<unknown>(
    "/public/waitlist",
    {
      method: "POST",
      body: JSON.stringify(validation.value),
    },
    false,
  ).then((value) => {
    if (!isJsonObject(value) || value.accepted !== true)
      throw createApiError(
        200,
        "The service returned an invalid waitlist response.",
        "INVALID_RESPONSE",
      );
    return { accepted: true };
  });
}

export async function getWorkflow(
  workflowId: string,
): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(
    `/workflows/${encodeURIComponent(workflowId)}`,
  );
  if (!isWorkflowProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid workflow response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export function getWorkflowEvents(
  workflowId: string,
): Promise<readonly WorkflowEventProjection[]> {
  return request<unknown>(
    `/workflows/${encodeURIComponent(workflowId)}/events`,
  ).then((value) => parseList(value, isWorkflowEvent, "workflow event list"));
}

export function listWorkflowActivity(): Promise<
  readonly WorkflowRecentActivityProjection[]
> {
  return request<unknown>("/workflows/activity").then((value) =>
    parseList(value, isWorkflowActivity, "workflow activity list"),
  );
}

export async function startWorkflow(
  input: WorkflowStartRequest,
): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>("/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isWorkflowProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid workflow response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function signalWorkflow(
  workflowId: string,
  input: WorkflowSignalRequest,
): Promise<{ accepted: true }> {
  const value = await request<unknown>(
    `/workflows/${encodeURIComponent(workflowId)}/signals`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  if (!isAcceptedResponse(value))
    throw createApiError(
      200,
      "The service returned an invalid Signal response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function cancelWorkflow(
  workflowId: string,
): Promise<{ accepted: true }> {
  const value = await request<unknown>(
    `/workflows/${encodeURIComponent(workflowId)}/cancel`,
    { method: "POST" },
  );
  if (!isAcceptedResponse(value))
    throw createApiError(
      200,
      "The service returned an invalid cancellation response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function rerunWorkflow(
  workflowId: string,
): Promise<WorkflowExecutionProjection> {
  const value = await request<unknown>(
    `/workflows/${encodeURIComponent(workflowId)}/rerun`,
    { method: "POST" },
  );
  if (!isWorkflowProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid rerun workflow response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function updateWorkflow(
  workflowId: string,
  input: WorkflowUpdateRequest,
): Promise<{ accepted: true; updateId: string }> {
  const value = await request<unknown>(
    `/workflows/${encodeURIComponent(workflowId)}/updates`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  if (!isUpdateResponse(value))
    throw createApiError(
      200,
      "The service returned an invalid Update response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export function listIntegrations(
  options: { scopeUnitId?: string } = {},
): Promise<readonly IntegrationProjection[]> {
  return listIntegrationsPage({ ...options, limit: DEFAULT_LIST_LIMIT }).then(
    (page) => page.items,
  );
}

export function listIntegrationsPage(
  input: ListQueryInput & { scopeUnitId?: string } = {},
): Promise<ListPage<IntegrationProjection>> {
  const params = new URLSearchParams(listQuery(input).replace(/^\?/u, ""));
  if (input.scopeUnitId) params.set("scopeUnitId", input.scopeUnitId);
  return requestList(
    `/integrations${params.size ? `?${params.toString()}` : ""}`,
    isIntegrationProjection,
    "integration list",
  );
}

export function listIntegrationCatalogPage(
  input: ListQueryInput & {
    channel?: "api" | "ai";
    type?: IntegrationType | "all";
  } = {},
): Promise<ListPage<IntegrationCatalogProjection>> {
  const params = new URLSearchParams(listQuery(input).replace(/^\?/u, ""));
  if (input.channel) params.set("channel", input.channel);
  if (input.type && input.type !== "all") params.set("type", input.type);
  return requestList(
    `/integrations/catalog${params.size ? `?${params.toString()}` : ""}`,
    isIntegrationCatalogProjection,
    "integration catalog list",
  );
}

export async function createIntegration(
  input: IntegrationCreateRequest,
): Promise<IntegrationProjection> {
  const value = await request<unknown>("/integrations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isIntegrationProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid integration response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export function listKnowledgeSources(
  options: { scopeUnitId?: string } = {},
): Promise<readonly KnowledgeSource[]> {
  return listKnowledgeSourcesPage({
    ...options,
    limit: DEFAULT_LIST_LIMIT,
  }).then((page) => page.items);
}

export function listKnowledgeSourcesPage(
  input: ListQueryInput & { scopeUnitId?: string } = {},
): Promise<ListPage<KnowledgeSource>> {
  const params = new URLSearchParams(listQuery(input).replace(/^\?/u, ""));
  if (input.scopeUnitId) params.set("scopeUnitId", input.scopeUnitId);
  return requestList(
    `/sources${params.size ? `?${params.toString()}` : ""}`,
    isKnowledgeSource,
    "Source list",
  );
}

export async function createKnowledgeSource(
  input: KnowledgeSourceCreateRequest,
): Promise<KnowledgeSource> {
  const value = await request<unknown>("/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isKnowledgeSource(value))
    throw createApiError(
      200,
      "The service returned an invalid Source response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function getKnowledgeSource(
  sourceId: string,
): Promise<KnowledgeSourceDetail> {
  const value = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}`,
  );
  if (!isKnowledgeSourceDetail(value))
    throw createApiError(
      200,
      "The service returned an invalid Source response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function createSourceRevision(
  sourceId: string,
  input: SourceRevisionCreateRequest,
): Promise<SourceRevision> {
  const value = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/revisions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  if (!isSourceRevision(value))
    throw createApiError(
      200,
      "The service returned an invalid source revision response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function uploadKnowledgeSourcePdf(
  file: File,
  name?: string,
  scopes?: Pick<KnowledgeSourceCreateRequest, "readScope" | "visibilityScope">,
): Promise<KnowledgeSourceUpload> {
  const form = new FormData();
  form.append("file", file);
  if (name?.trim()) form.append("name", name.trim());
  if (scopes?.readScope)
    form.append("readScope", JSON.stringify(scopes.readScope));
  if (scopes?.visibilityScope)
    form.append("visibilityScope", JSON.stringify(scopes.visibilityScope));
  const value = await request<unknown>("/sources/uploads", {
    method: "POST",
    body: form,
  });
  if (!isKnowledgeSourceUpload(value))
    throw createApiError(
      200,
      "The service returned an invalid Source upload response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function startSourceIngestion(
  sourceId: string,
  revisionId: string,
  trigger: SourceIngestionTrigger = SourceIngestionTrigger.Manual,
): Promise<SourceIngestionLaunch> {
  const value = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/revisions/${encodeURIComponent(revisionId)}/ingest`,
    {
      method: "POST",
      body: JSON.stringify({ trigger }),
    },
  );
  if (!isSourceIngestionLaunch(value))
    throw createApiError(
      200,
      "The service returned an invalid source ingestion response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function updateIntegration(
  integrationId: string,
  input: IntegrationUpdateRequest,
): Promise<IntegrationProjection> {
  const value = await request<unknown>(
    `/integrations/${encodeURIComponent(integrationId)}`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  if (!isIntegrationProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid integration response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function getWebhookEndpoint(
  integrationId: string,
): Promise<WebhookEndpointProjection | null> {
  let value: unknown;
  try {
    value = await request<unknown>(
      `/integrations/${encodeURIComponent(integrationId)}/webhook`,
    );
  } catch (error) {
    if (isApiError(error) && error.code === "WEBHOOK_ENDPOINT_NOT_FOUND")
      return null;
    throw error;
  }
  if (!isWebhookEndpointProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid webhook endpoint response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function provisionWebhookEndpoint(
  integrationId: string,
  endpointKey?: string,
): Promise<WebhookEndpointSecretResponse> {
  const value = await request<unknown>(
    `/integrations/${encodeURIComponent(integrationId)}/webhook`,
    {
      method: "POST",
      body: JSON.stringify(endpointKey ? { endpointKey } : {}),
    },
  );
  if (!isWebhookEndpointSecretResponse(value))
    throw createApiError(
      200,
      "The service returned an invalid webhook provisioning response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function rotateWebhookEndpoint(
  integrationId: string,
): Promise<WebhookEndpointSecretResponse> {
  const value = await request<unknown>(
    `/integrations/${encodeURIComponent(integrationId)}/webhook/rotate`,
    { method: "POST" },
  );
  if (!isWebhookEndpointSecretResponse(value))
    throw createApiError(
      200,
      "The service returned an invalid webhook rotation response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function setWebhookEndpointStatus(
  integrationId: string,
  status: "active" | "disabled",
): Promise<WebhookEndpointProjection> {
  const value = await request<unknown>(
    `/integrations/${encodeURIComponent(integrationId)}/webhook/${status === "active" ? "enable" : "disable"}`,
    { method: "POST" },
  );
  if (!isWebhookEndpointProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid webhook status response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function startIntegrationAuthorization(
  integrationId: string,
): Promise<IntegrationAuthorizationStart> {
  const value = await request<unknown>(
    `/integrations/${encodeURIComponent(integrationId)}/authorization/start`,
    { method: "POST" },
  );
  if (!isIntegrationAuthorizationStart(value))
    throw createApiError(
      200,
      "The service returned an invalid authorization response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function getOrganization(): Promise<OrganizationProjection> {
  const value = await request<unknown>("/organization");
  if (!isOrganizationProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid organization response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function updateOrganizationOnboarding(
  input: OrganizationOnboardingUpdateRequest,
): Promise<OrganizationOnboardingProjection> {
  const value = await request<unknown>("/organization/onboarding", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!isOrganizationOnboardingProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid onboarding response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function startOrganizationOnboarding(): Promise<OrganizationOnboardingProjection> {
  const value = await request<unknown>("/organization/onboarding/start", {
    method: "POST",
  });
  if (!isOrganizationOnboardingProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid onboarding response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function resetOrganizationOnboarding(): Promise<OrganizationOnboardingProjection> {
  const value = await request<unknown>("/organization/onboarding/reset", {
    method: "POST",
  });
  if (!isOrganizationOnboardingProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid onboarding response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function createOrganizationUnit(
  input: OrganizationUnitCreateRequest,
): Promise<OrganizationUnitProjection> {
  const value = await request<unknown>("/organization/units", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isOrganizationUnitProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid organization unit response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function createOrganizationPermission(
  input: OrganizationPermissionCreateRequest,
): Promise<OrganizationPermissionProjection> {
  const value = await request<unknown>("/organization/permissions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isOrganizationPermissionProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid organization permission response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function updateOrganizationPermission(
  permissionId: string,
  input: OrganizationPermissionUpdateRequest,
): Promise<OrganizationPermissionProjection> {
  const value = await request<unknown>(
    `/organization/permissions/${encodeURIComponent(permissionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  if (!isOrganizationPermissionProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid organization permission response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function deleteOrganizationPermission(
  permissionId: string,
): Promise<void> {
  const value = await request<unknown>(
    `/organization/permissions/${encodeURIComponent(permissionId)}`,
    { method: "DELETE" },
  );
  if (!isJsonObject(value) || value.deleted !== true)
    throw createApiError(
      200,
      "The service returned an invalid organization permission response.",
      "INVALID_RESPONSE",
    );
}

export function listOrganizationAccessRequests(): Promise<
  readonly OrganizationAccessRequestRecord[]
> {
  return request<unknown>("/organization/access-requests").then((value) =>
    parseList(
      value,
      isOrganizationAccessRequestRecord,
      "organization access request list",
    ),
  );
}

export async function createOrganizationAccessRequest(
  input: OrganizationAccessRequestCreateRequest,
): Promise<OrganizationAccessRequestRecord> {
  const value = await request<unknown>("/organization/access-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isOrganizationAccessRequestRecord(value))
    throw createApiError(
      200,
      "The service returned an invalid access request response.",
      "INVALID_RESPONSE",
    );
  return value;
}

async function decideOrganizationAccessRequest(
  requestId: string,
  action: "approve" | "reject" | "apply",
): Promise<OrganizationAccessRequestRecord> {
  const value = await request<unknown>(
    `/organization/access-requests/${encodeURIComponent(requestId)}/${action}`,
    { method: "POST" },
  );
  if (!isOrganizationAccessRequestRecord(value))
    throw createApiError(
      200,
      "The service returned an invalid access request response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export function approveOrganizationAccessRequest(
  requestId: string,
): Promise<OrganizationAccessRequestRecord> {
  return decideOrganizationAccessRequest(requestId, "approve");
}

export function rejectOrganizationAccessRequest(
  requestId: string,
): Promise<OrganizationAccessRequestRecord> {
  return decideOrganizationAccessRequest(requestId, "reject");
}

export function applyOrganizationAccessRequest(
  requestId: string,
): Promise<OrganizationAccessRequestRecord> {
  return decideOrganizationAccessRequest(requestId, "apply");
}

export async function queryContextGraph(
  input: GraphInspectionQueryRequest,
): Promise<GraphInspectionProjection> {
  const value = await request<unknown>("/context/graph/query", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isGraphInspectionProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid context graph response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function queryAgentMemory(
  input: MemoryInspectionQueryRequest,
): Promise<MemoryInspectionProjection> {
  const value = await request<unknown>("/context/memory/query", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isMemoryInspectionProjection(value))
    throw createApiError(
      200,
      "The service returned an invalid agent memory response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export function listMemoryChanges(
  limit = DEFAULT_LIST_LIMIT,
): Promise<readonly MemoryChangeRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  return request<unknown>(`/context/memory/changes?limit=${boundedLimit}`).then(
    (value) => parseList(value, isMemoryChangeRecord, "memory change list"),
  );
}

export async function createMemoryChange(
  input: MemoryChangeRequest,
): Promise<MemoryChangeRecord> {
  const value = await request<unknown>("/context/memory/changes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isMemoryChangeRecord(value))
    throw createApiError(
      200,
      "The service returned an invalid memory change response.",
      "INVALID_RESPONSE",
    );
  return value;
}

async function decideMemoryChange(
  changeId: string,
  action: "approve" | "reject" | "apply",
): Promise<MemoryChangeRecord> {
  const value = await request<unknown>(
    `/context/memory/changes/${encodeURIComponent(changeId)}/${action}`,
    { method: "POST" },
  );
  if (!isMemoryChangeRecord(value))
    throw createApiError(
      200,
      "The service returned an invalid memory change response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export function approveMemoryChange(
  changeId: string,
): Promise<MemoryChangeRecord> {
  return decideMemoryChange(changeId, "approve");
}

export function rejectMemoryChange(
  changeId: string,
): Promise<MemoryChangeRecord> {
  return decideMemoryChange(changeId, "reject");
}

export function applyMemoryChange(
  changeId: string,
): Promise<MemoryChangeRecord> {
  return decideMemoryChange(changeId, "apply");
}

export function listSavedInvestigationsPage(
  input: ListQueryInput = {},
): Promise<ListPage<SavedInvestigation>> {
  return requestList(
    `/investigations${listQuery(input)}`,
    isSavedInvestigation,
    "saved investigation list",
  );
}

export async function getSavedInvestigation(
  investigationId: string,
): Promise<SavedInvestigation> {
  const value = await request<unknown>(
    `/investigations/${encodeURIComponent(investigationId)}`,
  );
  if (!isSavedInvestigation(value))
    throw createApiError(
      200,
      "The service returned an invalid saved investigation response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function createSavedInvestigation(
  input: SavedInvestigationCreateRequest,
): Promise<SavedInvestigation> {
  const value = await request<unknown>("/investigations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isSavedInvestigation(value))
    throw createApiError(
      200,
      "The service returned an invalid saved investigation response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function deleteSavedInvestigation(
  investigationId: string,
): Promise<{ deleted: true }> {
  const value = await request<unknown>(
    `/investigations/${encodeURIComponent(investigationId)}`,
    { method: "DELETE" },
  );
  if (!isJsonObject(value) || value.deleted !== true)
    throw createApiError(
      200,
      "The service returned an invalid saved investigation response.",
      "INVALID_RESPONSE",
    );
  return { deleted: true };
}

export function listNotificationsPage(
  input: ListQueryInput = {},
): Promise<ListPage<NotificationProjection>> {
  return requestList(
    `/notifications${listQuery(input)}`,
    isNotification,
    "notification list",
  );
}

export function listNotifications(
  input: ListQueryInput = {},
): Promise<readonly NotificationProjection[]> {
  return listNotificationsPage({
    ...input,
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
  }).then((page) => page.items);
}

export function listRecommendations(): Promise<
  readonly RecommendationProjection[]
> {
  return request<unknown>("/investigations/recommendations").then((value) =>
    parseList(value, isRecommendation, "recommendation list"),
  );
}

export async function updateRecommendation(
  recommendationId: string,
  action: "accept" | "dismiss",
): Promise<RecommendationProjection> {
  const value = await request<unknown>(
    `/investigations/recommendations/${encodeURIComponent(recommendationId)}/${action}`,
    { method: "POST" },
  );
  if (!isRecommendation(value))
    throw createApiError(
      200,
      "The service returned an invalid recommendation response.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<{ read: true }> {
  const value = await request<unknown>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "POST" },
  );
  if (!isJsonObject(value) || value.read !== true)
    throw createApiError(
      200,
      "The service returned an invalid notification response.",
      "INVALID_RESPONSE",
    );
  return { read: true };
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const value = await request<unknown>("/settings/notifications");
  if (!isNotificationPreferences(value))
    throw createApiError(
      200,
      "The service returned invalid notification preferences.",
      "INVALID_RESPONSE",
    );
  return value;
}

export async function updateNotificationPreferences(
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  const value = await request<unknown>("/settings/notifications", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!isNotificationPreferences(value))
    throw createApiError(
      200,
      "The service returned invalid notification preferences.",
      "INVALID_RESPONSE",
    );
  return value;
}
