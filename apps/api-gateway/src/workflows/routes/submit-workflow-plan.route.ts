import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowPlanServiceError,
  submitWorkflowPlan,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus, workflowResponseStatus } from "../utils.js";
import { parseWorkflowPlan } from "./parse-workflow-plan.js";

export function submitWorkflowPlanRoute(): Handler<GatewayEnv> {
  return async (context) => {
    const plan = parseWorkflowPlan(await context.req.json().catch(() => null));
    if (!plan) {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "A valid workflow-change-plan.v1 is required." } },
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
