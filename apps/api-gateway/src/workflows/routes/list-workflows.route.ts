import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, listWorkflows, type WorkflowServiceOptions } from "../services/workflow.service.js";
import { authorizationErrorStatus } from "../utils.js";

export function listWorkflowsRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    try {
      return context.json({ data: await listWorkflows(context.get("principal"), options) });
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
