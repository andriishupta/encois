import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  approveWorkflowPlan,
  isWorkflowPlanServiceError,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus } from "../utils.js";

export function approveWorkflowPlanRoute(): Handler<GatewayEnv> {
  return async (context) => {
    const planId = context.req.param("planId")?.trim();
    if (!planId) return context.json({ error: { code: "INVALID_REQUEST", message: "Plan id is required." } }, 400);

    try {
      const data = await approveWorkflowPlan(context.get("principal"), planId);
      return context.json({ data });
    } catch (error) {
      if (isWorkflowPlanServiceError(error)) {
        return context.json({ error: { code: error.code, message: error.message } }, workflowPlanErrorStatus(error.code));
      }
      throw error;
    }
  };
}
