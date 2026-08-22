import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, rerunWorkflow, type WorkflowServiceOptions } from "../services/workflow.service.js";
import { workflowCommandErrorStatus, workflowStartResponseStatus } from "../utils.js";

export function rerunWorkflowRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const workflowId = context.req.param("workflowId")?.trim();
    if (!workflowId) return context.json({ error: { code: "INVALID_REQUEST", message: "Workflow id is required." } }, 400);
    try {
      const data = await rerunWorkflow(context.get("principal"), workflowId, context.get("requestId"), context.get("traceId"), options);
      return context.json({ data }, workflowStartResponseStatus(data.reused));
    } catch (error) {
      if (isWorkflowServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, workflowCommandErrorStatus(error.code));
      throw error;
    }
  };
}
