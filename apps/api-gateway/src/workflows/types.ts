import type { WorkflowRunStatus as PersistenceWorkflowRunStatus } from "@encois/persistence";
import type { CoordinatorEvent, ExecutionScope, JsonObject, WorkflowBlueprint, WorkflowUpdateRequest } from "@encois/contracts";

export type WorkflowRunStatus = PersistenceWorkflowRunStatus;

export const USER_BLUEPRINT_WORKFLOW_TYPE = "encois.user-blueprint.v1";
export const COORDINATOR_WORKFLOW_TYPE = "CoordinatorWorkflow";
export const BOOTSTRAP_WORKFLOW_TYPE = "BootstrapProjectWorkflow";

export const PLATFORM_WORKFLOW_TYPES = [
  USER_BLUEPRINT_WORKFLOW_TYPE,
  COORDINATOR_WORKFLOW_TYPE,
  BOOTSTRAP_WORKFLOW_TYPE,
] as const;

export type WorkflowStartRequest = {
  workflowType: string;
  version?: string;
  key?: string;
  blueprintId?: string;
  blueprintVersion?: string;
  input?: JsonObject;
  scope?: Partial<ExecutionScope>;
  blueprint?: WorkflowBlueprint;
  idempotencyKey?: string;
};

export type WorkflowStartCommand = {
  workflowType: string;
  workflowId: string;
  taskQueue: string;
  input: {
    contractVersion: "workflow-blueprint.v1";
    actorId: string;
    organizationId: string;
    requestId: string;
    traceId?: string;
    workflowId: string;
    policyVersion: string;
    scope: ExecutionScope;
    userId?: string;
    blueprint?: WorkflowBlueprint;
    businessInput: JsonObject;
    payload: JsonObject;
    idempotencyKey?: string;
  };
  requestHash: string;
};

export type WorkflowSignalRequest = {
  contractVersion: "workflow-signal.v1";
  signalName: "blueprint-approval";
  signalId: string;
  payload: JsonObject;
};

export type { WorkflowUpdateRequest };

export type WorkflowExecutionProjection = {
  workflowId: string;
  runId?: string;
  workflowType: string;
  blueprintId?: string;
  namespace: string;
  taskQueue: string;
  status: WorkflowRunStatus;
  organizationId: string;
  reused?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowIdentity = {
  organizationId: string;
  workflowType: string;
  key: string;
};

function safePart(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return (normalized || fallback).slice(0, 96);
}

/**
 * Generates a stable, tenant-prefixed Temporal Workflow Id.
 * A caller-provided key is idempotent within an organization and workflow type.
 */
export function buildWorkflowId(identity: WorkflowIdentity): string {
  return [
    "workflow",
    safePart(identity.organizationId, "organization"),
    safePart(identity.workflowType, "workflow"),
    safePart(identity.key, "request"),
  ].join(":");
}

/** Stable Temporal id for the long-lived organization/project Coordinator. */
export function buildCoordinatorWorkflowId(organizationId: string, coordinatorId: string): string {
  return buildWorkflowId({
    organizationId,
    workflowType: COORDINATOR_WORKFLOW_TYPE,
    key: coordinatorId,
  });
}
