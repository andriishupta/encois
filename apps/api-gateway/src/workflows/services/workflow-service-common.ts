import {
  isJsonObject,
  WorkflowExecutionStatus,
  type WorkflowExecutionStatus as WorkflowExecutionStatusValue,
} from "@encois/contracts";
import {
  type ApplicationError,
  applicationError,
  isApplicationError,
} from "../../application-error.js";
import type { AosPrincipal } from "../../middleware/aos.js";

export type WorkflowServiceError = ApplicationError;

export type PersistedWorkflowRunStatus = Exclude<
  WorkflowExecutionStatusValue,
  "preparing"
>;

export function persistedWorkflowRunStatus(
  status: WorkflowExecutionStatusValue,
): PersistedWorkflowRunStatus {
  return status === WorkflowExecutionStatus.Preparing
    ? WorkflowExecutionStatus.Queued
    : status;
}

export function workflowServiceError(
  code: string,
  message: string,
): WorkflowServiceError {
  return applicationError(code, message);
}

export function isWorkflowServiceError(
  error: unknown,
): error is WorkflowServiceError {
  return isApplicationError(error);
}

export function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
