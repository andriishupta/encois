import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, listWorkflows, type WorkflowServiceOptions } from "../services/workflow.service.js";

export function listWorkflowsRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    try {
      return context.json({ data: await listWorkflows(context.get("principal"), options) });
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          error.code === "FORBIDDEN" ? 403 : 401,
        );
      }
      throw error;
    }
  };
}
