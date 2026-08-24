import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  listWorkflowActivity,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import { authorizationErrorStatus } from "../utils.js";

export function listWorkflowActivityRoute(
  options: WorkflowServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const data = await listWorkflowActivity(
        context.get("principal"),
        options,
      );
      return context.json({ data });
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          authorizationErrorStatus(error.code),
        );
      }
      throw error;
    }
  };
}
