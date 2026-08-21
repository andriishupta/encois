/** Versioned wire contracts shared by the TypeScript and Go boundaries. */
export const ContractVersion = {
  ExecutionContext: "execution-context.v1",
  WorkflowBlueprint: "workflow-blueprint.v1",
  WorkflowResult: "blueprint-workflow-result.v1",
  WorkflowSignal: "workflow-signal.v1",
  ToolRequest: "tool-request.v1",
  ToolResult: "tool-result.v1",
  ArtifactWrite: "artifact-write.v1",
  ArtifactWriteResult: "artifact-write-result.v1",
  GraphQuery: "graph-query.v1",
  GraphQueryResult: "graph-query-result.v1",
  AgentMemory: "agent-memory.v1",
  AgentMemoryResult: "agent-memory-result.v1",
  ToolManifest: "tool-manifest.v1",
  WorkflowUpdate: "workflow-update.v1",
  WorkflowChangePlan: "workflow-change-plan.v1",
  WorkflowChangePlanV2: "workflow-change-plan.v2",
  CoordinatorEvent: "coordinator-event.v1",
  Coordinator: "coordinator.v1",
  BootstrapProject: "bootstrap-project.v1",
  AuthorizationCheck: "authorization-check.v1",
  WorkflowDefinition: "workflow-definition.v1",
} as const;
export type ContractVersion = (typeof ContractVersion)[keyof typeof ContractVersion];

export const TemporalWorkflowType = {
  UserBlueprint: "encois.user-blueprint.v1",
  Coordinator: "CoordinatorWorkflow",
  BootstrapProject: "BootstrapProjectWorkflow",
} as const;
export type TemporalWorkflowType = (typeof TemporalWorkflowType)[keyof typeof TemporalWorkflowType];

export const WorkflowStepKind = {
  Tool: "tool",
  Agent: "agent",
  Transform: "transform",
  Condition: "condition",
  Wait: "wait",
  Approval: "approval",
} as const;
export type WorkflowStepKind = (typeof WorkflowStepKind)[keyof typeof WorkflowStepKind];

export const WorkflowExecutionStatus = {
  Queued: "queued",
  Running: "running",
  Waiting: "waiting",
  Partial: "partial",
  Failed: "failed",
  Completed: "completed",
  Cancelled: "cancelled",
} as const;
export type WorkflowExecutionStatus = (typeof WorkflowExecutionStatus)[keyof typeof WorkflowExecutionStatus];

export const WorkflowResultStatus = {
  Completed: "completed",
  Waiting: "waiting",
  Failed: "failed",
} as const;
export type WorkflowResultStatus = (typeof WorkflowResultStatus)[keyof typeof WorkflowResultStatus];

export const ToolResultStatus = {
  Mocked: "mocked",
  Completed: "completed",
  Waiting: "waiting",
  Failed: "failed",
} as const;
export type ToolResultStatus = (typeof ToolResultStatus)[keyof typeof ToolResultStatus];

export const GraphQueryStatus = {
  Completed: "completed",
  Deferred: "deferred",
  Failed: "failed",
} as const;
export type GraphQueryStatus = (typeof GraphQueryStatus)[keyof typeof GraphQueryStatus];

export const AgentMemoryOperation = {
  Retrieve: "retrieve",
  Distill: "distill",
} as const;
export type AgentMemoryOperation = (typeof AgentMemoryOperation)[keyof typeof AgentMemoryOperation];

export const AgentMemoryStatus = {
  Completed: "completed",
  Deferred: "deferred",
  Failed: "failed",
} as const;
export type AgentMemoryStatus = (typeof AgentMemoryStatus)[keyof typeof AgentMemoryStatus];

export const ToolSideEffects = {
  ReadOnly: "read-only",
  ExternalWrite: "external-write",
} as const;
export type ToolSideEffects = (typeof ToolSideEffects)[keyof typeof ToolSideEffects];

export const WorkflowSignalName = {
  BlueprintApproval: "blueprint-approval",
} as const;
export type WorkflowSignalName = (typeof WorkflowSignalName)[keyof typeof WorkflowSignalName];

export const WorkflowUpdateName = {
  BlueprintContext: "blueprint-context",
} as const;
export type WorkflowUpdateName = (typeof WorkflowUpdateName)[keyof typeof WorkflowUpdateName];

export const CoordinatorEventType = {
  WorkflowPlanApproved: "workflow-plan-approved",
  WorkflowPlanApplied: "workflow-plan-applied",
  WorkflowCompleted: "workflow-completed",
  IntegrationConnected: "integration-connected",
  SourceReady: "source-ready",
  ReconcileRequested: "reconcile-requested",
  ProviderChanged: "provider-changed",
} as const;
export type CoordinatorEventType = (typeof CoordinatorEventType)[keyof typeof CoordinatorEventType];

export const WorkflowChangeKind = {
  Create: "create",
  Update: "update",
  Deprecate: "deprecate",
  Cancel: "cancel",
} as const;
export type WorkflowChangeKind = (typeof WorkflowChangeKind)[keyof typeof WorkflowChangeKind];

export const CoordinatorSignalName = {
  Event: "coordinator-event",
} as const;
export type CoordinatorSignalName = (typeof CoordinatorSignalName)[keyof typeof CoordinatorSignalName];

export const OrganizationUnitType = {
  Organization: "organization",
  Department: "department",
  Team: "team",
  Project: "project",
  Service: "service",
  Custom: "custom",
} as const;
export type OrganizationUnitType = (typeof OrganizationUnitType)[keyof typeof OrganizationUnitType];

export const ScopeRuleMode = {
  Grant: "grant",
  Restrict: "restrict",
} as const;
export type ScopeRuleMode = (typeof ScopeRuleMode)[keyof typeof ScopeRuleMode];

export const FreshnessStatus = {
  Fresh: "fresh",
  Stale: "stale",
  Unknown: "unknown",
} as const;
export type FreshnessStatus = (typeof FreshnessStatus)[keyof typeof FreshnessStatus];

export const WorkflowStatusReason = {
  TemporaryError: "temporary_error",
  MissingCredentials: "missing_credentials",
  HumanApproval: "human_approval",
  CapabilityUnavailable: "capability_unavailable",
  ProviderUnavailable: "provider_unavailable",
  InvalidInput: "invalid_input",
  DegradedEvidence: "degraded_evidence",
} as const;
export type WorkflowStatusReason = (typeof WorkflowStatusReason)[keyof typeof WorkflowStatusReason];

export const ArtifactRetentionClass = {
  Ephemeral: "ephemeral",
  Investigation: "investigation",
  SourceSnapshot: "source_snapshot",
  LegalHold: "legal_hold",
} as const;
export type ArtifactRetentionClass = (typeof ArtifactRetentionClass)[keyof typeof ArtifactRetentionClass];

export const MemoryRedactionStatus = {
  Applied: "applied",
  NoMatch: "no_match",
  Deferred: "deferred",
} as const;
export type MemoryRedactionStatus = (typeof MemoryRedactionStatus)[keyof typeof MemoryRedactionStatus];

export const IntegrationStatus = {
  Pending: "pending",
  Active: "active",
  Disabled: "disabled",
  Error: "error",
} as const;
export type IntegrationStatus = (typeof IntegrationStatus)[keyof typeof IntegrationStatus];

export const AuthAccessStatus = {
  Active: "active",
  Pending: "pending",
} as const;
export type AuthAccessStatus = (typeof AuthAccessStatus)[keyof typeof AuthAccessStatus];
