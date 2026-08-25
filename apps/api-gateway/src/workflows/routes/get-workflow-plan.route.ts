import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  getWorkflowPlan,
  isWorkflowPlanServiceError,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus } from "../utils.js";

export const getWorkflowPlanRoute: Handler<GatewayEnv> = async (context) => {
  const planId = context.req.param("planId")?.trim();
  if (!planId)
    return context.json(
      { error: { code: "INVALID_REQUEST", message: "Plan id is required." } },
      400,
    );

  try {
    const data = await getWorkflowPlan(context.get("principal"), planId);
    if (!data)
      return context.json(
        { error: { code: "WORKFLOW_PLAN_NOT_FOUND", message: "Workflow change plan not found." } },
        404,
      );
    return context.json({ data });
  } catch (error) {
    if (isWorkflowPlanServiceError(error))
      return context.json(
        { error: { code: error.code, message: error.message } },
        workflowPlanErrorStatus(error.code),
      );
    throw error;
  }
};
