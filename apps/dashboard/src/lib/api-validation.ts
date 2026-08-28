import type {
  GraphInspectionProjection,
  IntegrationAuthorizationStart,
  IntegrationCatalogProjection,
  IntegrationProjection,
  KnowledgeSource,
  MemoryChangeRecord,
  MemoryInspectionProjection,
  NotificationPreferences,
  NotificationProjection,
  OrganizationAccessRequestRecord,
  OrganizationOnboardingProjection,
  OrganizationPermissionProjection,
  OrganizationProjection,
  OrganizationUnitProjection,
  RecommendationProjection,
  SavedInvestigation,
  SourceIngestionRun,
  SourceRevision,
  WebhookEndpointProjection,
  WebhookEndpointSecretResponse,
  WorkflowBlueprintProjection,
  WorkflowCreationPreview,
  WorkflowEventProjection,
  WorkflowExecutionProjection,
  WorkflowPlannerVersionProjection,
  WorkflowPlanRecord,
  WorkflowRecentActivityProjection,
  WorkflowTemplateProjection,
} from "@encois/contracts/browser";
import {
  AccessLevel,
  CoordinationMode,
  IntegrationCatalogStatus,
  IntegrationStatus,
  IntegrationType,
  isJsonObject,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  OrganizationMembershipStatus,
  OrganizationOnboardingStatus,
  RecommendationStatus,
  RecommendationTarget,
  SourceRevisionStatus,
  WorkflowExecutionStatus,
  WorkflowStatusReason,
  WorkflowStepKind,
} from "@encois/contracts/browser";

export type KnowledgeSourceDetail = {
  source: KnowledgeSource;
  revisions: readonly SourceRevision[];
  ingestionRuns: readonly SourceIngestionRun[];
};

export type KnowledgeSourceUpload = {
  source: KnowledgeSource;
  revision: SourceRevision;
};
export type SourceIngestionLaunch = {
  source: KnowledgeSource;
  revision: SourceRevision;
  workflow: {
    workflowId: string;
    runId?: string;
    status: string;
    reused?: boolean;
  };
  resultContract: string;
};

export function isWorkflowProjection(
  value: unknown,
): value is WorkflowExecutionProjection {
  if (!isJsonObject(value)) return false;
  if (
    typeof value.workflowId !== "string" ||
    typeof value.workflowType !== "string" ||
    typeof value.namespace !== "string" ||
    typeof value.taskQueue !== "string" ||
    typeof value.organizationId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    return false;
  if (
    !Object.values(WorkflowExecutionStatus).includes(
      value.status as WorkflowExecutionStatus,
    )
  )
    return false;
  if (
    value.scope !== undefined &&
    (!isJsonObject(value.scope) ||
      !Array.isArray(value.scope.ids) ||
      value.scope.ids.some((id) => typeof id !== "string"))
  )
    return false;
  return (
    value.statusReason === undefined ||
    Object.values(WorkflowStatusReason).includes(
      value.statusReason as WorkflowStatusReason,
    )
  );
}

export function isWorkflowEvent(
  value: unknown,
): value is WorkflowEventProjection {
  if (
    !isJsonObject(value) ||
    typeof value.id !== "string" ||
    typeof value.eventType !== "string" ||
    typeof value.status !== "string" ||
    !isJsonObject(value.metadata) ||
    typeof value.occurredAt !== "string"
  )
    return false;
  if (
    value.statusReason !== undefined &&
    !Object.values(WorkflowStatusReason).includes(
      value.statusReason as WorkflowStatusReason,
    )
  )
    return false;
  if (
    value.evidence !== undefined &&
    (!Array.isArray(value.evidence) ||
      value.evidence.some(
        (item) => !isJsonObject(item) || typeof item.reference !== "string",
      ))
  )
    return false;
  if (
    value.trace !== undefined &&
    (!isJsonObject(value.trace) ||
      (value.trace.durationMs !== undefined &&
        typeof value.trace.durationMs !== "number") ||
      (value.trace.attempt !== undefined &&
        typeof value.trace.attempt !== "number"))
  )
    return false;
  return true;
}

export function isWorkflowTemplate(value: unknown): boolean {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== "workflow-template.v1" ||
    typeof value.version !== "string" ||
    typeof value.workflowType !== "string" ||
    typeof value.purpose !== "string"
  )
    return false;
  if (
    !isJsonObject(value.inputs) ||
    !Array.isArray(value.providerSlots) ||
    !Array.isArray(value.steps) ||
    !isJsonObject(value.output)
  )
    return false;
  return (
    typeof value.output.type === "string" &&
    typeof value.output.description === "string" &&
    value.steps.every((step) => {
      if (
        !isJsonObject(step) ||
        typeof step.id !== "string" ||
        typeof step.kind !== "string" ||
        !Object.values(WorkflowStepKind).includes(step.kind as WorkflowStepKind)
      )
        return false;
      if (step.tool !== undefined && typeof step.tool !== "string")
        return false;
      if (
        step.agentDefinition !== undefined &&
        typeof step.agentDefinition !== "string"
      )
        return false;
      if (
        step.providerSlot !== undefined &&
        typeof step.providerSlot !== "string"
      )
        return false;
      return true;
    })
  );
}

export function isWorkflowTemplateProjection(
  value: unknown,
): value is WorkflowTemplateProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.key === "string" &&
    typeof value.category === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.keywords) &&
    value.keywords.every((keyword) => typeof keyword === "string") &&
    Array.isArray(value.requiredCapabilities) &&
    value.requiredCapabilities.every(
      (capability) => typeof capability === "string",
    ) &&
    ["active", "disabled", "deleted"].includes(value.status as string) &&
    typeof value.version === "string" &&
    typeof value.schemaVersion === "string" &&
    isWorkflowTemplate(value.template)
  );
}

export function isWorkflowBlueprintProjection(
  value: unknown,
): value is WorkflowBlueprintProjection {
  return (
    isJsonObject(value) &&
    typeof value.blueprintId === "string" &&
    typeof value.version === "string" &&
    typeof value.name === "string" &&
    typeof value.purpose === "string" &&
    value.workflowType === "encois.dynamic.v1" &&
    typeof value.status === "string" &&
    ["draft", "approved", "retired"].includes(value.status) &&
    typeof value.isCurrent === "boolean" &&
    Array.isArray(value.steps) &&
    value.steps.every(
      (step) =>
        isJsonObject(step) &&
        typeof step.id === "string" &&
        typeof step.kind === "string",
    ) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isWorkflowPlanRecord(
  value: unknown,
): value is WorkflowPlanRecord {
  return (
    isJsonObject(value) &&
    typeof value.planId === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.coordinatorId === "string" &&
    typeof value.status === "string" &&
    ["proposed", "approved", "rejected", "applied", "expired"].includes(
      value.status,
    ) &&
    typeof value.approvalRequired === "boolean" &&
    isJsonObject(value.plan) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isWorkflowPlannerVersion(
  value: unknown,
): value is WorkflowPlannerVersionProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    (value.plannerName === undefined ||
      typeof value.plannerName === "string") &&
    (value.plannerVersion === undefined ||
      typeof value.plannerVersion === "string") &&
    (value.sourceSchemaVersion === undefined ||
      typeof value.sourceSchemaVersion === "string") &&
    (value.promptVersion === undefined ||
      typeof value.promptVersion === "string") &&
    (value.promptHash === undefined || typeof value.promptHash === "string") &&
    typeof value.versionHash === "string" &&
    typeof value.firstPlanId === "string" &&
    typeof value.lastPlanId === "string" &&
    typeof value.usageCount === "number" &&
    typeof value.firstSeenAt === "string" &&
    typeof value.lastSeenAt === "string"
  );
}

export function isWorkflowCreationPreview(
  value: unknown,
): value is WorkflowCreationPreview {
  const blueprint = isJsonObject(value) ? value.blueprint : undefined;
  return (
    isJsonObject(value) &&
    isJsonObject(value.intent) &&
    isJsonObject(value.plan) &&
    isJsonObject(blueprint) &&
    typeof blueprint.version === "string" &&
    typeof blueprint.purpose === "string" &&
    Array.isArray(blueprint.steps) &&
    blueprint.steps.every(
      (step) =>
        isJsonObject(step) &&
        typeof step.id === "string" &&
        typeof step.kind === "string",
    ) &&
    isJsonObject(value.source) &&
    typeof value.source.kind === "string" &&
    typeof value.source.title === "string" &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === "string") &&
    Array.isArray(value.requiredCapabilities) &&
    value.requiredCapabilities.every(
      (capability) => typeof capability === "string",
    ) &&
    Array.isArray(value.providerBindings) &&
    value.providerBindings.every(
      (binding) =>
        isJsonObject(binding) &&
        typeof binding.slotKey === "string" &&
        typeof binding.required === "boolean" &&
        typeof binding.status === "string" &&
        ["ready", "missing"].includes(binding.status) &&
        Array.isArray(binding.capabilities) &&
        binding.capabilities.every(
          (capability) => typeof capability === "string",
        ),
    ) &&
    typeof value.approvalRequired === "boolean"
  );
}

export function isWorkflowActivity(
  value: unknown,
): value is WorkflowRecentActivityProjection {
  return (
    isJsonObject(value) &&
    isWorkflowEvent(value) &&
    typeof (value as Record<string, unknown>).workflowId === "string" &&
    typeof (value as Record<string, unknown>).workflowLabel === "string"
  );
}

export function isIntegrationProjection(
  value: unknown,
): value is IntegrationProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.provider === "string" &&
    Object.values(IntegrationType).includes(value.type as IntegrationType) &&
    Object.values(IntegrationStatus).includes(value.status as IntegrationStatus)
  );
}

export function isIntegrationCatalogProjection(
  value: unknown,
): value is IntegrationCatalogProjection {
  return (
    isJsonObject(value) &&
    typeof value.key === "string" &&
    typeof value.provider === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Object.values(IntegrationType).includes(value.type as IntegrationType) &&
    Object.values(IntegrationCatalogStatus).includes(
      value.status as IntegrationCatalogStatus,
    ) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every((capability) => typeof capability === "string") &&
    typeof value.updatedAt === "string"
  );
}

export function isWebhookEndpointProjection(
  value: unknown,
): value is WebhookEndpointProjection {
  return (
    isJsonObject(value) &&
    typeof value.integrationId === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.endpointKey === "string" &&
    typeof value.provider === "string" &&
    Object.values(IntegrationStatus).includes(
      value.status as IntegrationStatus,
    ) &&
    typeof value.secretConfigured === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.url === undefined || typeof value.url === "string")
  );
}

export function isWebhookEndpointSecretResponse(
  value: unknown,
): value is WebhookEndpointSecretResponse {
  return (
    isJsonObject(value) &&
    typeof value.secret === "string" &&
    isWebhookEndpointProjection(value.endpoint)
  );
}

export function isIntegrationAuthorizationStart(
  value: unknown,
): value is IntegrationAuthorizationStart {
  return (
    isJsonObject(value) &&
    typeof value.integrationId === "string" &&
    typeof value.provider === "string" &&
    (value.status === "redirect" || value.status === "pending") &&
    (value.authorizationUrl === undefined ||
      typeof value.authorizationUrl === "string") &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string")
  );
}

export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    isJsonObject(value) &&
    value.contractVersion === "knowledge-source.v1" &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.name === "string" &&
    Object.values(KnowledgeSourceKind).includes(
      value.kind as KnowledgeSourceKind,
    ) &&
    Object.values(KnowledgeSourceStatus).includes(
      value.status as KnowledgeSourceStatus,
    ) &&
    isJsonObject(value.readScope) &&
    Array.isArray(value.readScope.ids) &&
    isJsonObject(value.visibilityScope) &&
    Array.isArray(value.visibilityScope.ids) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.freshness === undefined ||
      (isJsonObject(value.freshness) &&
        typeof value.freshness.source === "string" &&
        typeof value.freshness.observedAt === "string" &&
        typeof value.freshness.status === "string"))
  );
}

export function isSourceRevision(value: unknown): value is SourceRevision {
  return (
    isJsonObject(value) &&
    value.contractVersion === "source-revision.v1" &&
    typeof value.id === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.revision === "string" &&
    Object.values(SourceRevisionStatus).includes(
      value.status as SourceRevisionStatus,
    ) &&
    typeof value.createdAt === "string"
  );
}

export function isSourceIngestionRun(
  value: unknown,
): value is SourceIngestionRun {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.sourceRevisionId === "string" &&
    typeof value.temporalWorkflowId === "string" &&
    typeof value.trigger === "string" &&
    ["queued", "running", "completed", "deferred", "failed"].includes(
      value.status as string,
    ) &&
    typeof value.factsCount === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isSavedInvestigation(
  value: unknown,
): value is SavedInvestigation {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.name === "string" &&
    ["graph", "memory", "workflow"].includes(value.kind as string) &&
    typeof value.query === "string" &&
    isJsonObject(value.params) &&
    isJsonObject(value.scope) &&
    Array.isArray(value.scope.ids) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isNotification(
  value: unknown,
): value is NotificationProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    ["info", "warning", "error"].includes(value.severity as string) &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isNotificationPreferences(
  value: unknown,
): value is NotificationPreferences {
  return (
    isJsonObject(value) &&
    [
      "emailEnabled",
      "pushEnabled",
      "workflowUpdates",
      "evidenceReady",
      "weeklyDigest",
    ].every((key) => typeof value[key] === "boolean")
  );
}

export function isRecommendation(
  value: unknown,
): value is RecommendationProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.recommendationKey === "string" &&
    typeof value.kind === "string" &&
    ["info", "attention"].includes(value.severity as string) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Object.values(RecommendationTarget).includes(
      value.target as RecommendationProjection["target"],
    ) &&
    typeof value.actionLabel === "string" &&
    Object.values(RecommendationStatus).includes(
      value.status as RecommendationProjection["status"],
    ) &&
    isJsonObject(value.scope) &&
    Array.isArray(value.scope.ids) &&
    isJsonObject(value.metadata) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.observedAt === "string"
  );
}

export function isKnowledgeSourceDetail(
  value: unknown,
): value is KnowledgeSourceDetail {
  return (
    isJsonObject(value) &&
    isKnowledgeSource(value.source) &&
    Array.isArray(value.revisions) &&
    value.revisions.every(isSourceRevision) &&
    Array.isArray(value.ingestionRuns) &&
    value.ingestionRuns.every(isSourceIngestionRun)
  );
}

export function isKnowledgeSourceUpload(
  value: unknown,
): value is KnowledgeSourceUpload {
  return (
    isJsonObject(value) &&
    isKnowledgeSource(value.source) &&
    isSourceRevision(value.revision)
  );
}

export function isSourceIngestionLaunch(
  value: unknown,
): value is SourceIngestionLaunch {
  return (
    isJsonObject(value) &&
    isKnowledgeSource(value.source) &&
    isSourceRevision(value.revision) &&
    isJsonObject(value.workflow) &&
    typeof value.workflow.workflowId === "string" &&
    typeof value.workflow.status === "string" &&
    typeof value.resultContract === "string"
  );
}

export function isOrganizationUnitProjection(
  value: unknown,
): value is OrganizationUnitProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    (value.parentId === null || typeof value.parentId === "string") &&
    typeof value.type === "string" &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.canView === "boolean" &&
    typeof value.canManage === "boolean" &&
    (value.canView
      ? typeof value.manager === "string" &&
        typeof value.memberCount === "number"
      : value.manager === undefined && value.memberCount === undefined)
  );
}

export function isOrganizationMemberProjection(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.initials === "string" &&
    typeof value.name === "string" &&
    typeof value.role === "string" &&
    typeof value.roleKey === "string" &&
    typeof value.status === "string" &&
    Object.values(OrganizationMembershipStatus).includes(
      value.status as OrganizationMembershipStatus,
    )
  );
}

export function isOrganizationPermissionProjection(
  value: unknown,
): value is OrganizationPermissionProjection {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.memberId === "string" &&
    typeof value.unitId === "string" &&
    Object.values(AccessLevel).includes(value.access as AccessLevel) &&
    value.propagateToChildren === true
  );
}

export function isOrganizationOnboardingProjection(
  value: unknown,
): value is OrganizationOnboardingProjection {
  return (
    isJsonObject(value) &&
    typeof value.organizationId === "string" &&
    typeof value.coordinatorId === "string" &&
    typeof value.status === "string" &&
    Object.values(OrganizationOnboardingStatus).includes(
      value.status as OrganizationOnboardingStatus,
    ) &&
    typeof value.coordinationMode === "string" &&
    Object.values(CoordinationMode).includes(
      value.coordinationMode as CoordinationMode,
    ) &&
    Array.isArray(value.selectedWorkflows) &&
    value.selectedWorkflows.every((item) => typeof item === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.lastError === undefined || typeof value.lastError === "string")
  );
}

export function isOrganizationAccessRequestRecord(
  value: unknown,
): value is OrganizationAccessRequestRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.requestedByUserId === "string" &&
    typeof value.requesterName === "string" &&
    typeof value.unitId === "string" &&
    typeof value.unitName === "string" &&
    ["viewer", "contributor", "manager"].includes(value.access as string) &&
    typeof value.reason === "string" &&
    ["proposed", "approved", "rejected", "applied"].includes(
      value.status as string,
    ) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isOrganizationProjection(
  value: unknown,
): value is OrganizationProjection {
  if (!isJsonObject(value) || !isJsonObject(value.organization)) return false;
  return (
    typeof value.organization.id === "string" &&
    typeof value.organization.slug === "string" &&
    typeof value.organization.name === "string" &&
    Array.isArray(value.units) &&
    value.units.every(isOrganizationUnitProjection) &&
    Array.isArray(value.members) &&
    value.members.every(isOrganizationMemberProjection) &&
    Array.isArray(value.permissions) &&
    value.permissions.every(isOrganizationPermissionProjection) &&
    isOrganizationOnboardingProjection(value.onboarding)
  );
}

export function isGraphInspectionProjection(
  value: unknown,
): value is GraphInspectionProjection {
  return (
    isJsonObject(value) &&
    typeof value.query === "string" &&
    [
      "all",
      "all_context",
      "source.facts",
      "project.related_entities",
      "release.blockers",
    ].includes(value.query) &&
    typeof value.status === "string" &&
    ["completed", "deferred", "failed"].includes(value.status) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node) =>
        isJsonObject(node) &&
        typeof node.id === "string" &&
        typeof node.type === "string" &&
        isJsonObject(node.properties),
    ) &&
    Array.isArray(value.edges) &&
    value.edges.every(
      (edge) =>
        isJsonObject(edge) &&
        typeof edge.id === "string" &&
        typeof edge.sourceId === "string" &&
        typeof edge.targetId === "string" &&
        typeof edge.relationship === "string" &&
        isJsonObject(edge.properties),
    ) &&
    (value.evidenceRefs === undefined ||
      (Array.isArray(value.evidenceRefs) &&
        value.evidenceRefs.every((ref) => typeof ref === "string"))) &&
    typeof value.generatedAt === "string"
  );
}

export function isMemoryInspectionProjection(
  value: unknown,
): value is MemoryInspectionProjection {
  return (
    isJsonObject(value) &&
    typeof value.agentDefinition === "string" &&
    typeof value.query === "string" &&
    isJsonObject(value.scope) &&
    Array.isArray(value.scope.ids) &&
    value.scope.ids.every((id) => typeof id === "string") &&
    typeof value.status === "string" &&
    ["completed", "deferred", "failed"].includes(value.status) &&
    Array.isArray(value.memories) &&
    value.memories.every(
      (memory) =>
        isJsonObject(memory) &&
        typeof memory.id === "string" &&
        typeof memory.agentDefinition === "string" &&
        typeof memory.summary === "string" &&
        Array.isArray(memory.evidenceRefs) &&
        memory.evidenceRefs.every((ref) => typeof ref === "string") &&
        typeof memory.observedAt === "string",
    ) &&
    typeof value.generatedAt === "string"
  );
}

export function isMemoryChangeRecord(
  value: unknown,
): value is MemoryChangeRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    (value.memoryId === undefined || typeof value.memoryId === "string") &&
    typeof value.agentDefinition === "string" &&
    isJsonObject(value.scope) &&
    Array.isArray(value.scope.ids) &&
    value.scope.ids.every((id) => typeof id === "string") &&
    ["add", "correct", "delete"].includes(value.action as string) &&
    (value.evidenceRefs === undefined ||
      (Array.isArray(value.evidenceRefs) &&
        value.evidenceRefs.every((ref) => typeof ref === "string"))) &&
    ["proposed", "approved", "rejected", "applied", "failed"].includes(
      value.status as string,
    ) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isAcceptedResponse(
  value: unknown,
): value is { accepted: true } {
  return isJsonObject(value) && value.accepted === true;
}

export function isUpdateResponse(
  value: unknown,
): value is { accepted: true; updateId: string } {
  return (
    isJsonObject(value) &&
    value.accepted === true &&
    typeof value.updateId === "string"
  );
}
