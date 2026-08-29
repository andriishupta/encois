import {
  isJsonObject,
  type JsonObject,
  TemporalWorkflowType,
} from "@encois/contracts";

export type WorkflowHttpStatus = 401 | 403 | 409 | 422 | 503;
export type WorkflowCommandHttpStatus = 403 | 404 | 409 | 503;

const unprocessableWorkflowErrors = new Set([
  "WORKFLOW_DEFINITION_NOT_FOUND",
  "BLUEPRINT_VERSION_REQUIRED",
  "BLUEPRINT_NOT_FOUND",
  "BLUEPRINT_INVALID",
  "WORKFLOW_NAME_INVALID",
  "WORKFLOW_TEMPLATE_REQUIRED",
  "WORKFLOW_TEMPLATE_NOT_FOUND",
  "WORKFLOW_TEMPLATE_DISABLED",
  "WORKFLOW_BLUEPRINT_REQUIRED",
  "WORKFLOW_BLUEPRINT_NOT_FOUND",
  "WORKFLOW_MANUAL_UNAVAILABLE",
  "INTEGRATION_CAPABILITY_MISSING",
  "BLUEPRINT_DATABASE_FAILED",
]);
const unavailableWorkflowErrors = new Set([
  "DATABASE_UNAVAILABLE",
  "BLUEPRINT_REGISTRY_UNAVAILABLE",
  "WORKFLOW_DATABASE_FAILED",
]);

export function isTemporalWorkflowType(
  value: unknown,
): value is TemporalWorkflowType {
  return (
    typeof value === "string" &&
    Object.values(TemporalWorkflowType).includes(value as TemporalWorkflowType)
  );
}

export function readOptionalString(
  value: JsonObject,
  key: string,
  maxLength = 128,
): string | null | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || candidate.length > maxLength)
    return null;
  return candidate;
}

export function readOptionalRecord(
  value: JsonObject,
  key: string,
): JsonObject | null | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return isJsonObject(candidate) ? candidate : null;
}

export function workflowErrorStatus(code: string): WorkflowHttpStatus {
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (unprocessableWorkflowErrors.has(code)) return 422;
  if (unavailableWorkflowErrors.has(code)) return 503;
  if (code === "IDEMPOTENCY_CONFLICT") return 409;
  if (code === "WORKFLOW_BLUEPRINT_CONFLICT") return 409;
  if (code === "COORDINATOR_NOT_READY") return 409;
  return 401;
}

export function workflowCommandErrorStatus(
  code: string,
): WorkflowCommandHttpStatus {
  if (code === "WORKFLOW_NOT_FOUND") return 404;
  if (
    code === "FORBIDDEN" ||
    code === "SCOPE_DENIED" ||
    code === "IDENTITY_NOT_RESOLVED"
  )
    return 403;
  if (
    code === "WORKFLOW_NOT_SIGNALABLE" ||
    code === "WORKFLOW_SIGNAL_CONFLICT" ||
    code === "WORKFLOW_NOT_CANCELLABLE" ||
    code === "WORKFLOW_NOT_RERUNNABLE" ||
    code === "WORKFLOW_REVISION_UNAVAILABLE"
  )
    return 409;
  if (code === "WORKFLOW_NOT_UPDATABLE" || code === "WORKFLOW_UPDATE_CONFLICT")
    return 409;
  return 503;
}

export function workflowStartResponseStatus(
  reused: boolean | undefined,
): 200 | 202 {
  return reused ? 200 : 202;
}

export function authorizationErrorStatus(code: string): 401 | 403 | 503 {
  if (
    code === "DATABASE_UNAVAILABLE" ||
    code === "BLUEPRINT_REGISTRY_UNAVAILABLE" ||
    code === "CAPABILITY_NOT_CONFIGURED"
  )
    return 503;
  return code === "FORBIDDEN" ? 403 : 401;
}
