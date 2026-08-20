import type { WorkflowRunStatus as PersistenceWorkflowRunStatus } from "@encois/persistence";

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
  input?: Record<string, unknown>;
  scope?: Record<string, unknown>;
};

export type WorkflowStartCommand = {
  workflowType: string;
  workflowId: string;
  taskQueue: string;
  input: {
    actorId: string;
    organizationId: string;
    requestId: string;
    workflowId: string;
    scope: readonly string[];
    userId?: string;
    blueprint?: Record<string, unknown>;
    payload: Record<string, unknown>;
    workflowScope: Record<string, unknown>;
  };
};

export type WorkflowExecutionProjection = {
  workflowId: string;
  runId?: string;
  workflowType: string;
  namespace: string;
  taskQueue: string;
  status: WorkflowRunStatus;
  organizationId: string;
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
