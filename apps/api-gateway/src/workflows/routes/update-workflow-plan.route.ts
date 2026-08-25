import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowPlanServiceError,
  updateWorkflowPlan,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus } from "../utils.js";
import { parseWorkflowPlan } from "./parse-workflow-plan.js";

export const updateWorkflowPlanRoute: Handler<GatewayEnv> = async (context) => {
  const planId = context.req.param("planId")?.trim();
  if (!planId)
    return context.json(
      { error: { code: "INVALID_REQUEST", message: "Plan id is required." } },
      400,
    );
  const plan = parseWorkflowPlan(await context.req.json().catch(() => null));
  if (!plan)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "A valid workflow-change-plan.v1 is required.",
        },
      },
      400,
    );

  try {
    const data = await updateWorkflowPlan(
      context.get("principal"),
      planId,
      plan,
    );
    return context.json({ data });
  } catch (error) {
    if (isWorkflowPlanServiceError(error))
      return context.json(
        { error: { code: error.code, message: error.message } },
        workflowPlanErrorStatus(error.code, 422),
      );
    throw error;
  }
};
