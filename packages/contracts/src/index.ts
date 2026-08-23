import { validateContract } from "./validation.js";
import { isJsonObject, type JsonObject } from "./json.js";
import {
  AgentMemoryOperation,
  AgentMemoryStatus,
  AccessLevel,
  AuthAccessStatus,
  ArtifactRetentionClass,
  ContractVersion,
  CoordinatorSignalName,
  CoordinatorEventType,
  GraphQueryStatus,
  FreshnessStatus,
  IntegrationStatus,
  MemoryRedactionStatus,
  OrganizationUnitType,
  OrganizationMembershipStatus,
  OrganizationAccessRequestStatus,
  OrganizationOnboardingStatus,
  CoordinationMode,
  RecommendationStatus,
  RecommendationTarget,
  ScopeRuleMode,
  ToolResultStatus,
  ToolSideEffects,
  TemporalWorkflowType,
  WorkflowChangeKind,
  WorkflowExecutionStatus,
  WorkflowResultStatus,
  WorkflowSignalName,
  WorkflowStepKind,
  WorkflowUpdateName,
  WorkflowStatusReason,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  SourceRevisionStatus,
  SourceIngestionTrigger,
  SourceIngestionStatus,
} from "./values.js";

export { resolveEffectiveScope, type EffectiveScope, type OrganizationUnitNode, type ScopeRule } from "./scope.js";
export { isJsonObject, type JsonObject } from "./json.js";
export { validateWaitlistRequest, WaitlistLimits, type WaitlistRequest, type WaitlistValidationField, type WaitlistValidationResult } from "./waitlist.js";
export { allPermissions, Permission, permissionImplications, permissionIncludes, isPermission, type Permission as PermissionKey } from "./permissions.generated.js";

export {
  AgentMemoryOperation,
  AgentMemoryStatus,
  AccessLevel,
  AuthAccessStatus,
  ArtifactRetentionClass,
  ContractVersion,
  CoordinatorSignalName,
  CoordinatorEventType,
  GraphQueryStatus,
  FreshnessStatus,
  IntegrationStatus,
  MemoryRedactionStatus,
  OrganizationUnitType,
  OrganizationMembershipStatus,
  OrganizationAccessRequestStatus,
  OrganizationOnboardingStatus,
  CoordinationMode,
  RecommendationStatus,
  RecommendationTarget,
  ScopeRuleMode,
  ToolResultStatus,
  ToolSideEffects,
  TemporalWorkflowType,
  WorkflowChangeKind,
  WorkflowExecutionStatus,
  WorkflowResultStatus,
  WorkflowSignalName,
  WorkflowStepKind,
  WorkflowUpdateName,
  WorkflowStatusReason,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  SourceRevisionStatus,
  SourceIngestionTrigger,
  SourceIngestionStatus,
} from "./values.js";

export { CONTRACT_SCHEMA_FILES, validateContract, type ContractSchemaName, type ContractValidationResult } from "./validation.js";

export type ExecutionScope = {
  /** Organization-unit IDs. No separate team/project scope namespaces exist. */
  ids: readonly string[];
};

export type SourceFreshness = {
  source: string;
  observedAt: string;
  ingestedAt?: string;
  expiresAt?: string;
  status: FreshnessStatus;
};

export type DataProvenance = {
  source: string;
  sourceId?: string;
  sourceRevisionId?: string;
  sourceRecordId?: string;
  artifactRef?: string;
  locator?: JsonObject;
  observedAt: string;
  ingestedAt?: string;
  transformationVersion?: string;
  visibilityScope?: readonly string[];
};

export type KnowledgeSourceScope = ExecutionScope;

export type KnowledgeSource = {
  contractVersion: typeof ContractVersion.KnowledgeSource;
  id: string;
  organizationId: string;
  name: string;
  kind: KnowledgeSourceKind;
  provider?: string;
  integrationId?: string;
  status: KnowledgeSourceStatus;
  readScope: KnowledgeSourceScope;
  visibilityScope: KnowledgeSourceScope;
  contentType?: string;
  currentRevisionId?: string;
  freshness?: SourceFreshness;
  createdAt: string;
  updatedAt: string;
};

export type SourceRevision = {
  contractVersion: typeof ContractVersion.SourceRevision;
  id: string;
  sourceId: string;
  organizationId: string;
  revision: string;
  status: SourceRevisionStatus;
  artifactRef?: string;
  sourceObjectId?: string;
  contentType?: string;
  checksum?: string;
  observedAt?: string;
  ingestedAt?: string;
  metadata?: JsonObject;
  createdAt: string;
};

export type SourceIngestionRun = {
  id: string;
  sourceId: string;
  sourceRevisionId: string;
  temporalWorkflowId: string;
  temporalRunId?: string;
  trigger: SourceIngestionTrigger;
  status: SourceIngestionStatus | "queued" | "running";
  currentStage?: string;
  factsCount: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type SourceIngestionRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.SourceIngestion;
  sourceId: string;
  sourceRevisionId: string;
  sourceKind: KnowledgeSourceKind;
  provider?: string;
  artifactRef?: string;
  sourceObjectId?: string;
  contentType?: string;
  trigger: SourceIngestionTrigger;
  readScope: KnowledgeSourceScope;
  visibilityScope: KnowledgeSourceScope;
};

export type SourceIngestionResult = {
  contractVersion: typeof ContractVersion.SourceIngestionResult;
  requestId: string;
  sourceId: string;
  sourceRevisionId: string;
  status: SourceIngestionStatus;
  stage: "acquired" | "parsed" | "normalized" | "graph_projected" | "memory_distilled";
  factsCount: number;
  evidenceRefs: readonly string[];
  freshness?: readonly SourceFreshness[];
  message?: string;
};

export type KnowledgeSourceCreateRequest = {
  name: string;
  kind: KnowledgeSourceKind;
  provider?: string;
  integrationId?: string;
  readScope: KnowledgeSourceScope;
  visibilityScope: KnowledgeSourceScope;
  contentType?: string;
  configuration?: JsonObject;
};

export type SavedInvestigationKind = "graph" | "memory" | "workflow";

export type SavedInvestigation = {
  id: string;
  organizationId: string;
  name: string;
  kind: SavedInvestigationKind;
  query: string;
  params: JsonObject;
  scope: ExecutionScope;
  createdAt: string;
  updatedAt: string;
};

export type SavedInvestigationCreateRequest = {
  name: string;
  kind: SavedInvestigationKind;
  query: string;
  params?: JsonObject;
  scope: ExecutionScope;
};

export type NotificationProjection = {
  id: string;
  type: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  readAt?: string;
  createdAt: string;
};

export type NotificationPreferences = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  workflowUpdates: boolean;
  evidenceReady: boolean;
  weeklyDigest: boolean;
  updatedAt?: string;
};

export type RecommendationProjection = {
  id: string;
  organizationId: string;
  recommendationKey: string;
  kind: string;
  severity: "info" | "attention";
  title: string;
  description: string;
  target: RecommendationTarget;
  actionLabel: string;
  status: RecommendationStatus;
  scope: ExecutionScope;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
  observedAt: string;
  acceptedAt?: string;
  dismissedAt?: string;
  resolvedAt?: string;
};

export type SourceRevisionCreateRequest = {
  revision: string;
  artifactRef?: string;
  sourceObjectId?: string;
  contentType?: string;
  checksum?: string;
  observedAt?: string;
  metadata?: JsonObject;
};

export type ExecutionContext = {
  contractVersion: typeof ContractVersion.ExecutionContext;
  requestId: string;
  traceId?: string;
  workflowId: string;
  runId?: string;
  organizationId: string;
  actorId: string;
  scope: ExecutionScope;
  policyVersion: string;
  /** Internal per-execution capability issued by the authenticated Gateway. */
  capability: string;
};

/** A versioned boundary that carries execution context under its own contract. */
export type ExecutionEnvelope = Omit<ExecutionContext, "contractVersion">;

export type WorkflowStep = {
  id: string;
  kind: WorkflowStepKind;
  tool?: string;
  agentDefinition?: string;
  dependsOn?: readonly string[];
  input?: JsonObject;
  requiresApproval?: boolean;
};

export type WorkflowBlueprint = {
  contractVersion: typeof ContractVersion.WorkflowBlueprint;
  blueprintId: string;
  version: string;
  name: string;
  workflowType: typeof TemporalWorkflowType.UserBlueprint;
  purpose: string;
  enabled: boolean;
  steps: readonly WorkflowStep[];
  allowedTools?: readonly string[];
  requiredScopes?: readonly string[];
  parameters?: Readonly<Record<string, string>>;
  inputSchemaRef?: string;
  outputSchemaRef?: string;
  requiresApproval?: boolean;
};

export type WorkflowStartRequest = {
  workflowType: TemporalWorkflowType;
  version?: string;
  key?: string;
  blueprintId?: string;
  blueprintVersion?: string;
  blueprint?: WorkflowBlueprint;
  input?: JsonObject;
  scope?: Partial<ExecutionScope>;
  idempotencyKey?: string;
};

export type WorkflowTemplateStep = {
  id: string;
  kind: WorkflowStepKind;
  tool?: string;
  providerSlot?: string;
  agentDefinition?: string;
  dependsOn?: readonly string[];
  input?: JsonObject;
  requiresApproval?: boolean;
};

export type WorkflowTemplate = {
  schemaVersion: "workflow-template.v1";
  version: string;
  workflowType: typeof TemporalWorkflowType.UserBlueprint;
  purpose: string;
  inputs: Readonly<Record<string, { type: string; description: string; required?: boolean }> >;
  providerSlots: readonly {
    key: string;
    capabilities: readonly string[];
    preferredProviders?: readonly string[];
    required?: boolean;
  }[];
  steps: readonly WorkflowTemplateStep[];
  output: {
    type: string;
    description: string;
  };
};

export type WorkflowTemplateProjection = {
  id: string;
  key: string;
  category: string;
  title: string;
  description: string;
  keywords: readonly string[];
  requiredCapabilities: readonly string[];
  version: string;
  schemaVersion: string;
  template: WorkflowTemplate;
};

export type WorkflowBlueprintStatus = "draft" | "approved" | "retired";

export type WorkflowBlueprintProjection = {
  blueprintId: string;
  version: string;
  name: string;
  purpose: string;
  workflowType: typeof TemporalWorkflowType.UserBlueprint;
  status: WorkflowBlueprintStatus;
  isCurrent: boolean;
  sourcePlanId?: string;
  steps: readonly WorkflowStep[];
  requiredScopes?: readonly string[];
  requiresApproval?: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
};

/** A product-level request for a governed Blueprint registry change. */
export type WorkflowBlueprintLifecycleRequest = {
  contractVersion: typeof ContractVersion.WorkflowBlueprintLifecycle;
  action: "create_revision" | "duplicate" | "deprecate" | "restore" | "mark_current";
  sourceVersion?: string;
  version?: string;
  name?: string;
  reason: string;
};

export type WorkflowCreationIntent = {
  mode: "template" | "blueprint" | "manual";
  name: string;
  description?: string;
  businessKey?: string;
  templateKey?: string;
  blueprintKey?: string;
  prompt?: string;
  businessInput?: JsonObject;
  scope?: Partial<ExecutionScope>;
  start?: boolean;
};

export type WorkflowCreationPreview = {
  intent: WorkflowCreationIntent;
  plan: WorkflowChangePlan;
  blueprint: WorkflowBlueprint;
  source: {
    kind: "template" | "blueprint" | "manual";
    key?: string;
    title: string;
  };
  warnings: readonly string[];
  requiredCapabilities: readonly string[];
  providerBindings: readonly WorkflowProviderBindingProjection[];
  approvalRequired: boolean;
};

export type WorkflowProviderBindingProjection = {
  slotKey: string;
  required: boolean;
  status: "ready" | "missing";
  provider?: string;
  integrationName?: string;
  capabilities: readonly string[];
};

export type WorkflowPlanRecord = {
  planId: string;
  organizationId: string;
  coordinatorId: string;
  projectId?: string;
  status: "proposed" | "approved" | "rejected" | "applied" | "expired";
  approvalRequired: boolean;
  plan: WorkflowChangePlan;
  submittedByUserId?: string;
  approvedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  appliedAt?: string;
};

export type WorkflowPlannerVersionProjection = {
  id: string;
  organizationId: string;
  plannerName?: string;
  plannerVersion?: string;
  sourceSchemaVersion?: string;
  promptVersion?: string;
  promptHash?: string;
  versionHash: string;
  firstPlanId: string;
  lastPlanId: string;
  usageCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type WorkflowPlanMetadata = {
  planner: {
    name: string;
    version: string;
  };
  sourceSchemaVersion?: string;
  promptVersion?: string;
  promptHash?: string;
};

export type WorkflowExecutionProjection = {
  workflowId: string;
  runId?: string;
  workflowType: string;
  blueprintId?: string;
  blueprintVersion?: string;
  parentWorkflowId?: string;
  trigger?: string;
  namespace: string;
  taskQueue: string;
  status: WorkflowExecutionStatus;
  statusReason?: WorkflowStatusReason;
  statusMessage?: string;
  retryAt?: string;
  organizationId: string;
  reused?: boolean;
  retentionUntil?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowEventProjection = {
  id: string;
  eventType: string;
  status: string;
  activityName?: string;
  agentRunId?: string;
  evidenceRef?: string;
  evidence?: readonly WorkflowEvidenceProjection[];
  trace?: WorkflowTraceProjection;
  metadata: JsonObject;
  occurredAt: string;
};

export type WorkflowEvidenceProjection = {
  reference: string;
  provenance?: DataProvenance;
  freshness?: SourceFreshness;
  confidence?: number;
};

export type WorkflowTraceProjection = {
  provider?: string;
  model?: string;
  durationMs?: number;
  attempt?: number;
  budget?: string;
  outcome?: string;
  redacted?: boolean;
};

export type WorkflowRecentActivityProjection = WorkflowEventProjection & {
  workflowId: string;
  workflowLabel: string;
};

export type IntegrationProjection = {
  id: string;
  name: string;
  provider: string;
  status: IntegrationStatus;
  scopeIds?: readonly string[];
  grantedScopes?: readonly string[];
  credentialConfigured?: boolean;
  authorizedAt?: string;
  lastHealthCheckAt?: string;
  lastError?: string;
  updatedAt?: string;
};

export type WebhookEndpointProjection = {
  integrationId: string;
  organizationId: string;
  endpointKey: string;
  provider: string;
  status: IntegrationStatus;
  secretConfigured: boolean;
  url?: string;
  createdAt: string;
  updatedAt: string;
};

export type WebhookEndpointSecretResponse = {
  endpoint: WebhookEndpointProjection;
  secret: string;
};

export type IntegrationAuthorizationStart = {
  integrationId: string;
  provider: string;
  status: "redirect" | "pending";
  authorizationUrl?: string;
  expiresAt?: string;
};

export type IntegrationCreateRequest = {
  displayName: string;
  provider: string;
  organizationUnitId: string;
  grantedScopes?: readonly string[];
};

export type IntegrationUpdateRequest = {
  displayName?: string;
  /** Only disabling is a human-controlled lifecycle transition. */
  status?: Extract<IntegrationStatus, "disabled">;
};

export type OrganizationUnitProjection = {
  id: string;
  organizationId: string;
  parentId: string | null;
  type: OrganizationUnitType;
  slug: string;
  name: string;
  description: string;
  /** Whether the caller may select this unit and read its scoped details. */
  canView: boolean;
  /** Whether the caller may manage this unit and its direct permissions. */
  canManage: boolean;
  /** Scoped details are omitted when canView is false. */
  manager?: string;
  /** Scoped details are omitted when canView is false. */
  memberCount?: number;
};

export type OrganizationMemberProjection = {
  id: string;
  initials: string;
  name: string;
  email?: string;
  role: string;
  roleKey: string;
  homeUnitId?: string;
  status: OrganizationMembershipStatus;
};

export type OrganizationPermissionProjection = {
  id: string;
  memberId: string;
  unitId: string;
  access: AccessLevel;
  /** Direct membership scopes inherit descendants in the current policy model. */
  propagateToChildren: true;
};

export type OrganizationOnboardingProjection = {
  organizationId: string;
  status: OrganizationOnboardingStatus;
  coordinatorId: string;
  coordinationMode: CoordinationMode;
  selectedWorkflows: readonly string[];
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationProjection = {
  organization: {
    id: string;
    slug: string;
    name: string;
  };
  units: readonly OrganizationUnitProjection[];
  members: readonly OrganizationMemberProjection[];
  permissions: readonly OrganizationPermissionProjection[];
  onboarding: OrganizationOnboardingProjection;
};

export type OrganizationOnboardingUpdateRequest = {
  coordinationMode?: CoordinationMode;
  selectedWorkflows?: readonly string[];
};

export type OrganizationUnitCreateRequest = {
  parentId?: string | null;
  type: OrganizationUnitType;
  name: string;
  slug?: string;
};

export type OrganizationPermissionCreateRequest = {
  memberId: string;
  unitId: string;
  access: AccessLevel;
};

export type OrganizationPermissionUpdateRequest = {
  access: AccessLevel;
};

export type OrganizationAccessRequestCreateRequest = {
  unitId: string;
  access: Exclude<AccessLevel, "admin">;
  reason: string;
};

export type OrganizationAccessRequestRecord = {
  id: string;
  organizationId: string;
  requestedByUserId: string;
  requesterName: string;
  requesterEmail?: string;
  unitId: string;
  unitName: string;
  access: Exclude<AccessLevel, "admin">;
  reason: string;
  status: OrganizationAccessRequestStatus;
  reviewedByUserId?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  appliedAt?: string;
};

export type AuthStatusResponse =
  | {
      status: typeof AuthAccessStatus.Active;
      userId: string;
      organizationId: string;
      permissions: readonly import("./permissions.generated.js").Permission[];
      displayName?: string;
    }
  | {
      status: typeof AuthAccessStatus.Pending;
    };

export type WaitlistSubmissionResponse = {
  accepted: true;
};

export type BlueprintWorkflowInput = {
  contractVersion: typeof ContractVersion.WorkflowBlueprint;
  requestId: string;
  traceId?: string;
  workflowId: string;
  organizationId: string;
  actorId: string;
  policyVersion: string;
  scope: ExecutionScope;
  businessInput: JsonObject;
  blueprint: WorkflowBlueprint;
};

export type BlueprintWorkflowResult = {
  contractVersion: typeof ContractVersion.WorkflowResult;
  status: WorkflowResultStatus;
  statusReason?: WorkflowStatusReason;
  steps: readonly BlueprintWorkflowStepResult[];
};

export type BlueprintWorkflowStepResult = {
  stepId: string;
  status: string;
  statusReason?: WorkflowStatusReason;
  data?: JsonObject;
  evidenceRefs?: readonly string[];
  provenance?: DataProvenance;
  confidence?: number;
  trace?: WorkflowTraceProjection;
  freshness?: readonly SourceFreshness[];
};

export type WorkflowSignalRequest =
  | {
      contractVersion: typeof ContractVersion.WorkflowSignal;
      signalName: typeof WorkflowSignalName.BlueprintApproval;
      signalId: string;
      payload: { stepId: string; approved: boolean; reason?: string; signalId?: string };
    }
  | {
      contractVersion: typeof ContractVersion.WorkflowSignal;
      signalName: typeof WorkflowSignalName.WorkflowPause | typeof WorkflowSignalName.WorkflowResume;
      signalId: string;
      payload: { reason?: string; signalId?: string };
    };

/** Events delivered to the long-lived per-organization/project Coordinator. */
export type CoordinatorEvent = {
  contractVersion: typeof ContractVersion.CoordinatorEvent;
  eventId: string;
  eventType: CoordinatorEventType;
  coordinatorId: string;
  organizationId: string;
  actorId?: string;
  planId?: string;
  approved?: boolean;
  blueprintId?: string;
  blueprintVersion?: string;
  workflowId?: string;
  key?: string;
  businessInput?: JsonObject;
  scope?: Partial<ExecutionScope>;
  reason?: string;
  evidenceRefs?: readonly string[];
  workflowStarts?: readonly {
    blueprintId: string;
    blueprintVersion: string;
    key: string;
    businessInput?: JsonObject;
    scope?: Partial<ExecutionScope>;
  }[];
};

export type WorkflowStartIntent = {
  key: string;
  businessInput?: JsonObject;
};

export type WorkflowUpdateRequest = {
  contractVersion: typeof ContractVersion.WorkflowUpdate;
  updateName: typeof WorkflowUpdateName.BlueprintContext;
  updateId: string;
  payload: {
    businessInput: JsonObject;
    reason?: string;
  };
};

export type WorkflowChangePlan = {
  contractVersion: typeof ContractVersion.WorkflowChangePlan;
  planId: string;
  coordinatorId: string;
  organizationId: string;
  projectId?: string;
  scope?: ExecutionScope;
  observedAt: string;
  metadata?: WorkflowPlanMetadata;
  evidenceRefs?: readonly string[];
  changes: readonly {
    kind: WorkflowChangeKind;
    targetBlueprintId?: string;
    targetBlueprintVersion?: string;
    targetWorkflowId?: string;
    blueprint?: WorkflowBlueprint;
    start?: WorkflowStartIntent;
    reason: string;
    evidenceRefs?: readonly string[];
    requiresApproval: boolean;
  }[];
};

export type ToolRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.ToolRequest;
  agentDefinition?: string;
  tool: string;
  arguments: JsonObject;
};

export type ToolResult = {
  contractVersion: typeof ContractVersion.ToolResult;
  requestId: string;
  tool: string;
  status: ToolResultStatus;
  data?: JsonObject;
  evidenceRefs?: readonly string[];
  provenance?: DataProvenance;
  confidence?: number;
  freshness?: readonly SourceFreshness[];
};

export type ArtifactWriteRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.ArtifactWrite;
  objectKey: string;
  contentType: string;
  dataRef: string;
  retentionClass?: ArtifactRetentionClass;
  retentionUntil?: string;
};

export type ArtifactWriteResult = {
  contractVersion: typeof ContractVersion.ArtifactWriteResult;
  requestId: string;
  artifactRef: string;
  objectKey: string;
  status: "mocked" | "completed";
  retentionClass?: ArtifactRetentionClass;
  retentionUntil?: string;
};

export type ArtifactReadRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.ArtifactRead;
  artifactRef: string;
};

/** A logical, scope-constrained graph lookup. The query is not raw provider SQL. */
export type GraphQueryRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.GraphQuery;
  query: string;
  params?: JsonObject;
};

export type GraphUpsertRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.GraphUpsert;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
};

export type GraphNode = {
  id: string;
  type: string;
  properties: JsonObject;
  provenance?: DataProvenance;
};

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  properties: JsonObject;
  provenance?: DataProvenance;
};

export type GraphQueryResult = {
  contractVersion: typeof ContractVersion.GraphQueryResult;
  requestId: string;
  status: GraphQueryStatus;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  evidenceRefs?: readonly string[];
  freshness?: readonly SourceFreshness[];
};

export type GraphInspectorQueryName =
  | "all"
  | "all_context"
  | "source.facts"
  | "project.related_entities"
  | "release.blockers";

export type GraphInspectionParams = {
  projectId?: string;
  nodeType?: string;
  relationship?: string;
  limit?: number;
};

/** Browser-facing, allowlisted graph inspection request. It never accepts provider SQL. */
export type GraphInspectionQueryRequest = {
  query: GraphInspectorQueryName;
  params?: GraphInspectionParams;
  scope?: ExecutionScope;
};

export type GraphInspectionProjection = {
  query: GraphInspectorQueryName;
  status: GraphQueryStatus;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  evidenceRefs?: readonly string[];
  freshness?: readonly SourceFreshness[];
  generatedAt: string;
};

export type AgentMemoryRequest = ExecutionEnvelope & {
  contractVersion: typeof ContractVersion.AgentMemory;
  agentDefinition: string;
  operation: AgentMemoryOperation;
  memoryScope: {
    agentDefinition: string;
    projectId?: string;
    userId?: string;
  };
  targetMemoryId?: string;
  replacementSummary?: string;
  query?: string;
  maxResults?: number;
  distillation?: {
    summary: string;
    evidenceRefs: readonly string[];
    observedAt: string;
    redactionStatus?: MemoryRedactionStatus;
    redactionVersion?: string;
  };
};

export type AgentMemoryRecord = {
  id: string;
  agentDefinition: string;
  projectId?: string;
  userId?: string;
  summary: string;
  evidenceRefs: readonly string[];
  observedAt: string;
  freshness?: SourceFreshness;
  workflowId?: string;
  runId?: string;
  retentionClass?: ArtifactRetentionClass;
  retentionUntil?: string;
};

export type AgentMemoryResult = {
  contractVersion: typeof ContractVersion.AgentMemoryResult;
  requestId: string;
  status: AgentMemoryStatus;
  memories: readonly AgentMemoryRecord[];
};

export type MemoryInspectionQueryRequest = {
  agentDefinition: string;
  query: string;
  projectId?: string;
  scope?: ExecutionScope;
  maxResults?: number;
};

export type MemoryInspectionProjection = {
  agentDefinition: string;
  query: string;
  scope: ExecutionScope;
  projectId?: string;
  status: AgentMemoryStatus;
  memories: readonly AgentMemoryRecord[];
  generatedAt: string;
};

export type MemoryChangeAction = "add" | "correct" | "delete";
export type MemoryChangeStatus = "proposed" | "approved" | "rejected" | "applied" | "failed";

export type MemoryChangeRequest = {
  memoryId?: string;
  agentDefinition: string;
  projectId?: string;
  userId?: string;
  scope: ExecutionScope;
  action: MemoryChangeAction;
  replacementSummary?: string;
  evidenceRefs?: readonly string[];
};

export type MemoryChangeRecord = MemoryChangeRequest & {
  id: string;
  organizationId: string;
  status: MemoryChangeStatus;
  requestedByUserId?: string;
  approvedByUserId?: string;
  runtimeRequestId?: string;
  providerOperationName?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  appliedAt?: string;
};

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolManifest = {
  contractVersion: typeof ContractVersion.ToolManifest;
  name: string;
  version: string;
  kind: "tool";
  description: string;
  sideEffects: ToolSideEffects;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  annotations: ToolAnnotations;
  requiredScope?: readonly string[];
  available: boolean;
  approvalRequired: boolean;
};

export function parseWorkflowBlueprint(value: unknown): WorkflowBlueprint | null {
  if (!isJsonObject(value)) return null;
  if (!validateContract("workflowBlueprint", value).valid) return null;
  if (value.contractVersion !== ContractVersion.WorkflowBlueprint) return null;
  if (value.workflowType !== TemporalWorkflowType.UserBlueprint) return null;
  if (typeof value.blueprintId !== "string" || value.blueprintId.trim().length === 0) return null;
  if (typeof value.version !== "string" || value.version.trim().length === 0) return null;
  if (typeof value.name !== "string" || typeof value.purpose !== "string") return null;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return null;
  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== "boolean") return null;
  if (!Array.isArray(value.steps) || value.steps.length === 0) return null;
  if (value.allowedTools !== undefined && (!Array.isArray(value.allowedTools) || value.allowedTools.some((tool) => typeof tool !== "string"))) return null;
  if (value.requiredScopes !== undefined && (!Array.isArray(value.requiredScopes) || value.requiredScopes.some((scope) => typeof scope !== "string"))) return null;
  if (value.parameters !== undefined && (!isJsonObject(value.parameters) || Object.values(value.parameters).some((parameter) => typeof parameter !== "string"))) return null;

  const steps: WorkflowStep[] = [];
  for (const candidate of value.steps) {
    if (!isJsonObject(candidate) || typeof candidate.id !== "string" || typeof candidate.kind !== "string") return null;
    if (!Object.values(WorkflowStepKind).includes(candidate.kind as WorkflowStepKind)) return null;
    if (candidate.tool !== undefined && typeof candidate.tool !== "string") return null;
    if (candidate.agentDefinition !== undefined && typeof candidate.agentDefinition !== "string") return null;
    if (candidate.dependsOn !== undefined && (!Array.isArray(candidate.dependsOn) || candidate.dependsOn.some((dependency) => typeof dependency !== "string"))) return null;
    if (candidate.input !== undefined && !isJsonObject(candidate.input)) return null;
    steps.push({
      id: candidate.id,
      kind: candidate.kind as WorkflowStepKind,
      ...(typeof candidate.tool === "string" ? { tool: candidate.tool } : {}),
      ...(typeof candidate.agentDefinition === "string" ? { agentDefinition: candidate.agentDefinition } : {}),
      ...(Array.isArray(candidate.dependsOn) ? { dependsOn: candidate.dependsOn as string[] } : {}),
      ...(isJsonObject(candidate.input) ? { input: candidate.input } : {}),
      ...(typeof candidate.requiresApproval === "boolean" ? { requiresApproval: candidate.requiresApproval } : {}),
    });
  }

  return {
    contractVersion: ContractVersion.WorkflowBlueprint,
    blueprintId: value.blueprintId,
    version: value.version,
    name: value.name,
    workflowType: TemporalWorkflowType.UserBlueprint,
    purpose: value.purpose,
    enabled: value.enabled !== false,
    steps,
    ...(Array.isArray(value.allowedTools) ? { allowedTools: value.allowedTools as string[] } : {}),
    ...(Array.isArray(value.requiredScopes) ? { requiredScopes: value.requiredScopes as string[] } : {}),
    ...(isJsonObject(value.parameters) ? { parameters: value.parameters as Record<string, string> } : {}),
    ...(typeof value.inputSchemaRef === "string" ? { inputSchemaRef: value.inputSchemaRef } : {}),
    ...(typeof value.outputSchemaRef === "string" ? { outputSchemaRef: value.outputSchemaRef } : {}),
    ...(typeof value.requiresApproval === "boolean" ? { requiresApproval: value.requiresApproval } : {}),
  };
}
