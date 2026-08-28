import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import { createWorkflowFromIntent } from "../services/workflow-creator.service.js";
import { workflowErrorStatus, workflowStartResponseStatus } from "../utils.js";
import { parseWorkflowCreationIntent } from "./parse-workflow-creation-intent.js";

export function submitWorkflowCreationRoute(
  options: WorkflowServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    const intent = parseWorkflowCreationIntent(
      await context.req.json().catch(() => null),
    );
    if (!intent)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid workflow creation intent is required.",
          },
        },
        400,
      );
    try {
      const data = await createWorkflowFromIntent(
        context.get("principal"),
        intent,
        options,
      );
      return context.json(
        { data },
        data.workflow ? workflowStartResponseStatus(data.workflow.reused) : 201,
      );
    } catch (error) {
      if (isWorkflowServiceError(error))
        return context.json(
          { error: { code: error.code, message: error.message } },
          workflowErrorStatus(error.code),
        );
      throw error;
    }
  };
}
