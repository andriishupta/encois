import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowPlanServiceError,
  listWorkflowPlannerVersions,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus } from "../utils.js";

export const listWorkflowPlannerVersionsRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const rawLimit = context.req.query("limit");
  const limit = rawLimit === undefined ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "limit must be an integer between 1 and 100.",
        },
      },
      400,
    );
  }
  try {
    return context.json({
      data: await listWorkflowPlannerVersions(context.get("principal"), limit),
    });
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
