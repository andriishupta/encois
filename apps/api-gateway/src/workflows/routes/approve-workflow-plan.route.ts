import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  approveWorkflowPlan,
  isWorkflowPlanServiceError,
} from "../services/workflow-plan.service.js";

export function approveWorkflowPlanRoute(): Handler<GatewayEnv> {
  return async (context) => {
    const planId = context.req.param("planId")?.trim();
    if (!planId) return context.json({ error: { code: "INVALID_REQUEST", message: "Plan id is required." } }, 400);

    try {
      const data = await approveWorkflowPlan(context.get("principal"), planId);
      return context.json({ data });
    } catch (error) {
      if (isWorkflowPlanServiceError(error)) {
        const status =
          error.code === "WORKFLOW_PLAN_NOT_FOUND"
            ? 404
            : error.code === "FORBIDDEN" || error.code === "SCOPE_DENIED"
              ? 403
              : error.code === "PERSISTENCE_UNAVAILABLE"
                ? 503
                : 409;
        return context.json({ error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  };
}
