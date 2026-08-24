import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  validateWorkflowChangePlan,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import { workflowValidationErrorStatus } from "../utils.js";
import { parseWorkflowPlan } from "./parse-workflow-plan.js";

export function validateWorkflowPlanRoute(
  _options: WorkflowServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    const plan = parseWorkflowPlan(await context.req.json().catch(() => null));
    if (!plan) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid workflow-change-plan.v1 is required.",
          },
        },
        400,
      );
    }

    try {
      const data = await validateWorkflowChangePlan(
        context.get("principal"),
        plan,
      );
      return context.json({ data });
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          workflowValidationErrorStatus(error.code),
        );
      }
      throw error;
    }
  };
}
