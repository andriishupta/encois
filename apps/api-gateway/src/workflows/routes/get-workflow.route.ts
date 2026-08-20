import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { WorkflowService, WorkflowServiceError } from "../services/workflow.service.js";

export function getWorkflowRoute(service: WorkflowService): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const workflowId = context.req.param("workflowId");
      if (!workflowId) {
        return context.json({ error: { code: "INVALID_REQUEST", message: "Workflow id is required." } }, 400);
      }
      const data = await service.get(context.get("principal"), workflowId);
      return data
        ? context.json({ data })
        : context.json({ error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found." } }, 404);
    } catch (error) {
      if (error instanceof WorkflowServiceError) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          error.code === "FORBIDDEN" ? 403 : 401,
        );
      }
      throw error;
    }
  };
}
