import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  getWorkflow,
  isWorkflowServiceError,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import { authorizationErrorStatus } from "../utils.js";

export function getWorkflowRoute(
  options: WorkflowServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const workflowId = context.req.param("workflowId");
      if (!workflowId) {
        return context.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Workflow id is required.",
            },
          },
          400,
        );
      }
      const data = await getWorkflow(
        context.get("principal"),
        workflowId,
        options,
      );
      return data
        ? context.json({ data })
        : context.json(
            {
              error: {
                code: "WORKFLOW_NOT_FOUND",
                message: "Workflow not found.",
              },
            },
            404,
          );
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
