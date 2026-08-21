import type { Handler } from "hono";
import { validateContract, type WorkflowChangePlan, type WorkflowChangePlanV2 } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowPlanServiceError,
  submitWorkflowPlan,
} from "../services/workflow-plan.service.js";

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
      return context.json({ data }, data.status === "proposed" ? 202 : 200);
    } catch (error) {
      if (isWorkflowPlanServiceError(error)) {
        const status =
          error.code === "FORBIDDEN" || error.code === "SCOPE_DENIED"
            ? 403
            : error.code === "IDEMPOTENCY_CONFLICT"
              ? 409
              : error.code === "PERSISTENCE_UNAVAILABLE"
                ? 503
                : 422;
        return context.json({ error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  };
}
