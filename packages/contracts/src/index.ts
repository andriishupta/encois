import { validateContract } from "./validation.js";

export { CONTRACT_SCHEMA_FILES, validateContract, type ContractSchemaName, type ContractValidationResult } from "./validation.js";

export const CONTRACT_VERSIONS = {
  executionContext: "execution-context.v1",
  releaseInvestigation: "release-investigation.v1",
  workflowBlueprint: "workflow-blueprint.v1",
  workflowResult: "blueprint-workflow-result.v1",
  toolRequest: "tool-request.v1",
  toolResult: "tool-result.v1",
  artifactWrite: "artifact-write.v1",
  artifactWriteResult: "artifact-write-result.v1",
  graphQuery: "graph-query.v1",
  graphQueryResult: "graph-query-result.v1",
  agentMemory: "agent-memory.v1",
  agentMemoryResult: "agent-memory-result.v1",
  toolManifest: "tool-manifest.v1",
  workflowUpdate: "workflow-update.v1",
  workflowChangePlan: "workflow-change-plan.v1",
  workflowChangePlanV2: "workflow-change-plan.v2",
  coordinatorEvent: "coordinator-event.v1",
} as const;

export const TEMPORAL_WORKFLOW_TYPES = {
  userBlueprint: "encois.user-blueprint.v1",
} as const;

export type JsonObject = Record<string, unknown>;

export type ExecutionScope = {
  ids: readonly string[];
  projectIds?: readonly string[];
  teamIds?: readonly string[];
};

export type ExecutionContext = {
  contractVersion: typeof CONTRACT_VERSIONS.executionContext;
  requestId: string;
  traceId?: string;
  workflowId: string;
  runId?: string;
  organizationId: string;
  actorId: string;
  scope: ExecutionScope;
  policyVersion: string;
};

/** A versioned boundary that carries execution context under its own contract. */
export type ExecutionEnvelope = Omit<ExecutionContext, "contractVersion">;

export type WorkflowStepKind = "tool" | "agent" | "transform" | "condition" | "wait" | "approval";

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
  contractVersion: typeof CONTRACT_VERSIONS.workflowBlueprint;
  blueprintId: string;
  version: string;
  name: string;
  workflowType: typeof TEMPORAL_WORKFLOW_TYPES.userBlueprint;
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
  workflowType: typeof TEMPORAL_WORKFLOW_TYPES.userBlueprint;
  version?: string;
  key: string;
  blueprint: WorkflowBlueprint;
  input: JsonObject;
  scope?: Partial<ExecutionScope>;
  idempotencyKey?: string;
};

export type WorkflowExecutionProjection = {
  workflowId: string;
  runId?: string;
  workflowType: string;
  blueprintId?: string;
  namespace: string;
  taskQueue: string;
  status: "queued" | "running" | "waiting" | "partial" | "failed" | "completed" | "cancelled";
  organizationId: string;
  reused?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReleaseInvestigationRequest = {
  contractVersion: typeof CONTRACT_VERSIONS.releaseInvestigation;
  projectKey: string;
  releaseKey: string;
  targetDate?: string;
  idempotencyKey?: string;
  scope?: Partial<ExecutionScope>;
};

export type ReleaseInvestigationResponse = {
  contractVersion: typeof CONTRACT_VERSIONS.releaseInvestigation;
  workflow: WorkflowExecutionProjection;
  reused: boolean;
};

export type BlueprintWorkflowInput = {
  contractVersion: typeof CONTRACT_VERSIONS.workflowBlueprint;
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
  contractVersion: typeof CONTRACT_VERSIONS.workflowResult;
  status: "completed" | "waiting" | "failed";
  steps: readonly JsonObject[];
};

export type WorkflowSignalRequest = {
  contractVersion: "workflow-signal.v1";
  signalName: "blueprint-approval";
  signalId: string;
  payload: JsonObject;
};

/** Events delivered to the long-lived per-organization/project Coordinator. */
export type CoordinatorEvent = {
  contractVersion: typeof CONTRACT_VERSIONS.coordinatorEvent;
  eventId: string;
  eventType:
    | "workflow-plan-approved"
    | "workflow-plan-applied"
    | "workflow-completed"
    | "integration-connected"
    | "source-ready"
    | "reconcile-requested"
    | "provider-changed";
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
  }[];
};

export type WorkflowStartIntent = {
  key: string;
  businessInput?: JsonObject;
};

export type WorkflowUpdateRequest = {
  contractVersion: typeof CONTRACT_VERSIONS.workflowUpdate;
  updateName: "blueprint-context";
  updateId: string;
  payload: {
    businessInput: JsonObject;
    reason?: string;
  };
};

export type WorkflowChangePlan = {
  contractVersion: typeof CONTRACT_VERSIONS.workflowChangePlan;
  planId: string;
  coordinatorId: string;
  organizationId: string;
  projectId?: string;
  observedAt: string;
  evidenceRefs?: readonly string[];
  changes: readonly {
    kind: "create" | "update" | "deprecate" | "cancel";
    targetWorkflowId?: string;
    blueprint?: WorkflowBlueprint;
    start?: WorkflowStartIntent;
    reason: string;
    evidenceRefs?: readonly string[];
    requiresApproval: boolean;
  }[];
};

/**
 * Lifecycle-aware plan contract. v1 remains the active create-plan contract;
 * v2 separates Blueprint registry targets from Temporal execution targets.
 */
export type WorkflowChangePlanV2 = {
  contractVersion: typeof CONTRACT_VERSIONS.workflowChangePlanV2;
  planId: string;
  coordinatorId: string;
  organizationId: string;
  projectId?: string;
  observedAt: string;
  evidenceRefs?: readonly string[];
  changes: readonly {
    kind: "create" | "update" | "deprecate" | "cancel";
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
  contractVersion: typeof CONTRACT_VERSIONS.toolRequest;
  agentDefinition?: string;
  tool: string;
  arguments: JsonObject;
};

export type ToolResult = {
  contractVersion: typeof CONTRACT_VERSIONS.toolResult;
  requestId: string;
  tool: string;
  status: "mocked" | "completed" | "waiting" | "failed";
  data?: JsonObject;
  evidenceRefs?: readonly string[];
};

export type ArtifactWriteRequest = ExecutionEnvelope & {
  contractVersion: typeof CONTRACT_VERSIONS.artifactWrite;
  objectKey: string;
  contentType: string;
  dataRef: string;
};

export type ArtifactWriteResult = {
  contractVersion: typeof CONTRACT_VERSIONS.artifactWriteResult;
  requestId: string;
  artifactRef: string;
  objectKey: string;
  status: "mocked" | "completed";
};

/** A logical, scope-constrained graph lookup. The query is not raw provider SQL. */
export type GraphQueryRequest = ExecutionEnvelope & {
  contractVersion: typeof CONTRACT_VERSIONS.graphQuery;
  query: string;
  params?: JsonObject;
};

export type GraphNode = {
  id: string;
  type: string;
  properties: JsonObject;
};

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  properties: JsonObject;
};

export type GraphQueryResult = {
  contractVersion: typeof CONTRACT_VERSIONS.graphQueryResult;
  requestId: string;
  status: "completed" | "deferred" | "failed";
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  evidenceRefs?: readonly string[];
};

export type AgentMemoryRequest = ExecutionEnvelope & {
  contractVersion: typeof CONTRACT_VERSIONS.agentMemory;
  agentDefinition: string;
  operation: "retrieve" | "distill";
  memoryScope: {
    agentDefinition: string;
    projectId?: string;
    userId?: string;
  };
  query?: string;
  maxResults?: number;
  distillation?: {
    summary: string;
    evidenceRefs: readonly string[];
    observedAt: string;
  };
};

export type AgentMemoryRecord = {
  id: string;
  agentDefinition: string;
  summary: string;
  evidenceRefs: readonly string[];
  observedAt: string;
};

export type AgentMemoryResult = {
  contractVersion: typeof CONTRACT_VERSIONS.agentMemoryResult;
  requestId: string;
  status: "completed" | "deferred" | "failed";
  memories: readonly AgentMemoryRecord[];
};

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolManifest = {
  contractVersion: typeof CONTRACT_VERSIONS.toolManifest;
  name: string;
  version: string;
  kind: "tool";
  description: string;
  sideEffects: "read-only" | "external-write";
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  annotations: ToolAnnotations;
  requiredScope?: readonly string[];
  available: boolean;
  approvalRequired: boolean;
};

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkflowBlueprint(value: unknown): WorkflowBlueprint | null {
  if (!isRecord(value)) return null;
  if (!validateContract("workflowBlueprint", value).valid) return null;
  if (value.contractVersion !== CONTRACT_VERSIONS.workflowBlueprint) return null;
  if (value.workflowType !== TEMPORAL_WORKFLOW_TYPES.userBlueprint) return null;
  if (typeof value.blueprintId !== "string" || value.blueprintId.trim().length === 0) return null;
  if (typeof value.version !== "string" || value.version.trim().length === 0) return null;
  if (typeof value.name !== "string" || typeof value.purpose !== "string") return null;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return null;
  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== "boolean") return null;
  if (!Array.isArray(value.steps) || value.steps.length === 0) return null;
  if (value.allowedTools !== undefined && (!Array.isArray(value.allowedTools) || value.allowedTools.some((tool) => typeof tool !== "string"))) return null;
  if (value.requiredScopes !== undefined && (!Array.isArray(value.requiredScopes) || value.requiredScopes.some((scope) => typeof scope !== "string"))) return null;
  if (value.parameters !== undefined && (!isRecord(value.parameters) || Object.values(value.parameters).some((parameter) => typeof parameter !== "string"))) return null;

  const steps: WorkflowStep[] = [];
  for (const candidate of value.steps) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.kind !== "string") return null;
    if (!(["tool", "agent", "transform", "condition", "wait", "approval"] as const).includes(candidate.kind as WorkflowStepKind)) return null;
    if (candidate.tool !== undefined && typeof candidate.tool !== "string") return null;
    if (candidate.agentDefinition !== undefined && typeof candidate.agentDefinition !== "string") return null;
    if (candidate.dependsOn !== undefined && (!Array.isArray(candidate.dependsOn) || candidate.dependsOn.some((dependency) => typeof dependency !== "string"))) return null;
    if (candidate.input !== undefined && !isRecord(candidate.input)) return null;
    steps.push({
      id: candidate.id,
      kind: candidate.kind as WorkflowStepKind,
      ...(typeof candidate.tool === "string" ? { tool: candidate.tool } : {}),
      ...(typeof candidate.agentDefinition === "string" ? { agentDefinition: candidate.agentDefinition } : {}),
      ...(Array.isArray(candidate.dependsOn) ? { dependsOn: candidate.dependsOn as string[] } : {}),
      ...(isRecord(candidate.input) ? { input: candidate.input } : {}),
      ...(typeof candidate.requiresApproval === "boolean" ? { requiresApproval: candidate.requiresApproval } : {}),
    });
  }

  return {
    contractVersion: CONTRACT_VERSIONS.workflowBlueprint,
    blueprintId: value.blueprintId,
    version: value.version,
    name: value.name,
    workflowType: TEMPORAL_WORKFLOW_TYPES.userBlueprint,
    purpose: value.purpose,
    enabled: value.enabled !== false,
    steps,
    ...(Array.isArray(value.allowedTools) ? { allowedTools: value.allowedTools as string[] } : {}),
    ...(Array.isArray(value.requiredScopes) ? { requiredScopes: value.requiredScopes as string[] } : {}),
    ...(isRecord(value.parameters) ? { parameters: value.parameters as Record<string, string> } : {}),
    ...(typeof value.inputSchemaRef === "string" ? { inputSchemaRef: value.inputSchemaRef } : {}),
    ...(typeof value.outputSchemaRef === "string" ? { outputSchemaRef: value.outputSchemaRef } : {}),
    ...(typeof value.requiresApproval === "boolean" ? { requiresApproval: value.requiresApproval } : {}),
  };
}

export function parseReleaseInvestigationRequest(value: unknown): ReleaseInvestigationRequest | null {
  if (!isRecord(value)) return null;
  if (!validateContract("releaseInvestigation", value).valid) return null;
  if (value.contractVersion !== CONTRACT_VERSIONS.releaseInvestigation) return null;
  if (typeof value.projectKey !== "string" || value.projectKey.trim().length === 0) return null;
  if (typeof value.releaseKey !== "string" || value.releaseKey.trim().length === 0) return null;
  if (value.targetDate !== undefined && typeof value.targetDate !== "string") return null;
  if (value.idempotencyKey !== undefined || value.scope !== undefined) {
    if (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== "string") return null;
    if (value.scope !== undefined && !isRecord(value.scope)) return null;
  }
  return {
    contractVersion: CONTRACT_VERSIONS.releaseInvestigation,
    projectKey: value.projectKey.trim(),
    releaseKey: value.releaseKey.trim(),
    targetDate: typeof value.targetDate === "string" ? value.targetDate : undefined,
    idempotencyKey: typeof value.idempotencyKey === "string" ? value.idempotencyKey : undefined,
    scope: value.scope as Partial<ExecutionScope> | undefined,
  };
}

export function createReleaseInvestigationBlueprint(input: ReleaseInvestigationRequest): WorkflowBlueprint {
  const sharedInput: JsonObject = {
    projectKey: input.projectKey,
    releaseKey: input.releaseKey,
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
  };

  return {
    contractVersion: CONTRACT_VERSIONS.workflowBlueprint,
    blueprintId: CONTRACT_VERSIONS.releaseInvestigation,
    version: "1.0.0",
    name: "Release investigation",
    workflowType: TEMPORAL_WORKFLOW_TYPES.userBlueprint,
    purpose: "Collect release evidence and produce an evidence-linked readiness summary.",
    enabled: true,
    allowedTools: ["jira.release_tasks", "github.release_activity"],
    steps: [
      {
        id: "jira-release-tasks",
        kind: "tool",
        tool: "jira.release_tasks",
        input: sharedInput,
      },
      {
        id: "github-release-activity",
        kind: "tool",
        tool: "github.release_activity",
        input: sharedInput,
      },
      {
        id: "release-summary",
        kind: "agent",
        agentDefinition: "release-investigation.synthesizer@1",
        dependsOn: ["jira-release-tasks", "github-release-activity"],
        input: {
          instruction: "Summarize release readiness using only the collected evidence.",
        },
      },
    ],
  };
}
