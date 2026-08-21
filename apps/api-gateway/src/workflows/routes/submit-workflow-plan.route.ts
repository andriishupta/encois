import type { Handler } from "hono";
import { validateContract, type WorkflowChangePlan, type WorkflowChangePlanV2 } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowPlanServiceError,
  submitWorkflowPlan,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus, workflowResponseStatus } from "../utils.js";

function parsePlan(value: unknown): WorkflowChangePlan | WorkflowChangePlanV2 | null {
  if (validateContract("workflowChangePlanV2", value).valid) return value as WorkflowChangePlanV2;
  if (validateContract("workflowChangePlan", value).valid) return value as WorkflowChangePlan;
  return null;
}

export function submitWorkflowPlanRoute(): Handler<GatewayEnv> {
  return async (context) => {
    const plan = parsePlan(await context.req.json().catch(() => null));
    if (!plan) {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "A valid workflow-change-plan.v1 or workflow-change-plan.v2 is required." } },
        400,
      );
    }

    try {
      const data = await submitWorkflowPlan(context.get("principal"), plan);
      return context.json({ data }, workflowResponseStatus(data.status));
    } catch (error) {
      if (isWorkflowPlanServiceError(error)) {
        return context.json({ error: { code: error.code, message: error.message } }, workflowPlanErrorStatus(error.code, 422));
      }
      throw error;
    }
  };
}
