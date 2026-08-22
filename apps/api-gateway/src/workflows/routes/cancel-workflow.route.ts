import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, cancelWorkflow, type WorkflowServiceOptions } from "../services/workflow.service.js";
import { workflowCommandErrorStatus } from "../utils.js";

export function cancelWorkflowRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const workflowId = context.req.param("workflowId");
    if (!workflowId) return context.json({ error: { code: "INVALID_REQUEST", message: "Workflow id is required." } }, 400);
    try {
      await cancelWorkflow(context.get("principal"), workflowId, options);
      return context.json({ data: { accepted: true } });
    } catch (error) {
      if (isWorkflowServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, workflowCommandErrorStatus(error.code));
      throw error;
    }
  };
}
