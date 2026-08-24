import { validateContract, type WorkflowChangePlan } from "@encois/contracts";

export function parseWorkflowPlan(value: unknown): WorkflowChangePlan | null {
  return validateContract("workflowChangePlan", value).valid
    ? (value as WorkflowChangePlan)
    : null;
}
