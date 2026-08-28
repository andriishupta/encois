import type {
  ContractVersion,
  CoordinationMode,
  ExecutionScope,
  JsonObject,
  KnowledgeSourceScope,
  TemporalWorkflowType,
  WorkflowBlueprint,
} from "@encois/contracts";
import type { WorkflowRunStatus as DatabaseWorkflowRunStatus } from "@encois/database";

export type WorkflowRunStatus = DatabaseWorkflowRunStatus;

export type WorkflowStartCommand = {
  workflowType: TemporalWorkflowType;
  workflowId: string;
  taskQueue: string;
  /** Allow a new execution only after a failed onboarding Coordinator run. */
  retryClosedExecution?: boolean;
  input: {
    contractVersion:
      | typeof ContractVersion.WorkflowBlueprint
      | typeof ContractVersion.SourceIngestion
      | typeof ContractVersion.Coordinator;
    actorId: string;
    organizationId: string;
    requestId: string;
    traceId?: string;
    workflowId: string;
    policyVersion: string;
    scope: ExecutionScope;
    capability: string;
    userId?: string;
    blueprint?: WorkflowBlueprint;
    blueprintVersion?: string;
    businessInput?: JsonObject;
    payload?: JsonObject;
    parentWorkflowId?: string;
    idempotencyKey?: string;
    sourceId?: string;
    sourceRevisionId?: string;
    sourceKind?: string;
    provider?: string;
    artifactRef?: string;
    sourceObjectId?: string;
    contentType?: string;
    trigger?: string;
    readScope?: KnowledgeSourceScope;
    visibilityScope?: KnowledgeSourceScope;
    coordinatorId?: string;
    coordinationMode?: CoordinationMode;
    selectedWorkflowRefs?: readonly string[];
    scopeType?: "organization" | "project";
    state?: {
      status:
        | "ONBOARDING"
        | "BOOTSTRAPPING"
        | "READY"
        | "RECONCILING"
        | "WAITING"
        | "SUSPENDED";
      version: number;
      onboardingComplete: boolean;
      connectedIntegrationIds?: readonly string[];
      activeWorkflowIds?: readonly string[];
      processedEventIds?: readonly string[];
      lastEvent?: string;
      lastError?: string;
      reconciliationCount: number;
    };
  };
  requestHash: string;
};

export type {
  WorkflowEventProjection,
  WorkflowExecutionProjection,
  WorkflowRecentActivityProjection,
  WorkflowSignalRequest,
  WorkflowStartRequest,
  WorkflowUpdateRequest,
} from "@encois/contracts";

export type WorkflowIdentity = {
  organizationId: string;
  organizationUnitId?: string;
  key: string;
};

function safePart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return (normalized || fallback).slice(0, 96);
}

/**
 * Generates a stable, tenant-prefixed Temporal Workflow Id.
 * The executable Temporal type is intentionally not part of the ID. It is
 * available as Temporal metadata, while the caller-provided key remains
 * idempotent within the organization and organization-unit scope.
 */
export function buildWorkflowId(identity: WorkflowIdentity): string {
  return [
    "org",
    safePart(identity.organizationId, "organization"),
    "unit",
    safePart(identity.organizationUnitId ?? "organization", "organization"),
    "run",
    safePart(identity.key, "request"),
  ].join(":");
}

/**
 * Stable Temporal id for the long-lived organization/project Coordinator.
 *
 * Coordinators are control-plane workflows, not organization-unit runs, so
 * keep their identity in a separate namespace from ordinary Blueprint runs.
 */
export function buildCoordinatorWorkflowId(
  organizationId: string,
  coordinatorId: string,
): string {
  return [
    "org",
    safePart(organizationId, "organization"),
    "coordinator",
    safePart(coordinatorId, "coordinator"),
  ].join(":");
}
