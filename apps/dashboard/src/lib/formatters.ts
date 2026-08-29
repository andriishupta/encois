import {
  WorkflowExecutionStatus,
  type WorkflowExecutionStatus as WorkflowExecutionStatusType,
  type WorkflowStatusReason,
} from "@encois/contracts/browser";

export function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function workflowLabel(
  blueprintId?: string,
  workflowType?: string,
  workflowName?: string,
): string {
  const source = workflowName || blueprintId || workflowType || "Workflow run";
  return humanizeKey(source.replace(/-blueprint$/u, ""));
}

export function workflowStatusLabel(
  status: WorkflowExecutionStatusType,
  reason?: WorkflowStatusReason,
): string {
  const label =
    status === WorkflowExecutionStatus.Preparing
      ? "Preparing workflow"
      : humanizeKey(status);
  return reason ? `${label} · ${humanizeKey(reason)}` : label;
}

export function formatDate(value?: string): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Time unavailable"
    : date.toLocaleString();
}

export function shortIdentifier(value: string, visibleCharacters = 12): string {
  if (value.length <= visibleCharacters) return value;
  const edge = Math.max(4, Math.floor((visibleCharacters - 1) / 2));
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}
