import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  applyWorkflowPlan,
  isWorkflowPlanServiceError,
  type WorkflowPlanApplicationOptions,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus } from "../utils.js";

export function applyWorkflowPlanRoute(
  options: WorkflowPlanApplicationOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    const planId = context.req.param("planId")?.trim();
    if (!planId)
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "Plan id is required." } },
        400,
      );

    try {
      const data = await applyWorkflowPlan(
        context.get("principal"),
        planId,
        options,
      );
      return context.json({ data }, 200);
    } catch (error) {
      if (isWorkflowPlanServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          workflowPlanErrorStatus(error.code),
        );
      }
      throw error;
    }
  };
}
