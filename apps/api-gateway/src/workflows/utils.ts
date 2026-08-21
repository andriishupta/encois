import { isRecord, TemporalWorkflowType, type JsonObject } from "@encois/contracts";

export type WorkflowHttpStatus = 401 | 403 | 409 | 422 | 503;
export type WorkflowPlanHttpStatus = 403 | 404 | 409 | 422 | 503;
export type WorkflowCommandHttpStatus = 403 | 404 | 409 | 503;

const unprocessableWorkflowErrors = new Set([
  "WORKFLOW_DEFINITION_NOT_FOUND",
  "BLUEPRINT_VERSION_REQUIRED",
  "BLUEPRINT_NOT_FOUND",
  "BLUEPRINT_INVALID",
]);
const unavailableWorkflowErrors = new Set(["PERSISTENCE_UNAVAILABLE", "BLUEPRINT_REGISTRY_UNAVAILABLE"]);

export function isTemporalWorkflowType(value: unknown): value is TemporalWorkflowType {
  return typeof value === "string" && Object.values(TemporalWorkflowType).includes(value as TemporalWorkflowType);
}

export function readOptionalString(
  value: JsonObject,
  key: string,
  maxLength = 128,
): string | null | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || candidate.length > maxLength) return null;
  return candidate;
}

export function readOptionalRecord(value: JsonObject, key: string): JsonObject | null | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return isRecord(candidate) ? candidate : null;
}

export function workflowErrorStatus(code: string): WorkflowHttpStatus {
  if (code === "FORBIDDEN") return 403;
  if (unprocessableWorkflowErrors.has(code)) return 422;
  if (unavailableWorkflowErrors.has(code)) return 503;
  if (code === "IDEMPOTENCY_CONFLICT") return 409;
  return 401;
}

export function workflowPlanErrorStatus(code: string, fallback: 409 | 422 = 409): WorkflowPlanHttpStatus {
  if (code === "PERSISTENCE_UNAVAILABLE") return 503;
  if (code === "WORKFLOW_PLAN_NOT_FOUND") return 404;
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED" || code === "IDENTITY_NOT_RESOLVED") return 403;
  return fallback;
}

export function workflowValidationErrorStatus(code: string): 401 | 403 | 422 {
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "WORKFLOW_PLAN_INVALID") return 422;
  return 401;
}

export function workflowCommandErrorStatus(code: string): WorkflowCommandHttpStatus {
  if (code === "WORKFLOW_NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  if (code === "WORKFLOW_NOT_SIGNALABLE" || code === "WORKFLOW_SIGNAL_CONFLICT") return 409;
  if (code === "WORKFLOW_NOT_UPDATABLE" || code === "WORKFLOW_UPDATE_CONFLICT") return 409;
  return 503;
}

export function workflowResponseStatus(status: string): 200 | 202 {
  return status === "proposed" ? 202 : 200;
}

export function workflowStartResponseStatus(reused: boolean | undefined): 200 | 202 {
  return reused ? 200 : 202;
}

export function authorizationErrorStatus(code: string): 401 | 403 {
  return code === "FORBIDDEN" ? 403 : 401;
}
