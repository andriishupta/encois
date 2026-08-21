import type { WorkflowRunStatus as PersistenceWorkflowRunStatus } from "@encois/persistence";
import {
  ContractVersion,
  TemporalWorkflowType,
  type CoordinatorEvent,
  type ExecutionScope,
  type KnowledgeSourceScope,
  type JsonObject,
  type WorkflowBlueprint,
} from "@encois/contracts";

export type WorkflowRunStatus = PersistenceWorkflowRunStatus;

export type WorkflowStartCommand = {
  workflowType: TemporalWorkflowType;
  workflowId: string;
  taskQueue: string;
  input: {
    contractVersion: typeof ContractVersion.WorkflowBlueprint | typeof ContractVersion.SourceIngestion;
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
    businessInput?: JsonObject;
    payload?: JsonObject;
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
  };
  requestHash: string;
};

export type {
  WorkflowExecutionProjection,
  WorkflowSignalRequest,
  WorkflowStartRequest,
  WorkflowUpdateRequest,
} from "@encois/contracts";

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
    workflowType: TemporalWorkflowType.Coordinator,
    key: coordinatorId,
  });
}
