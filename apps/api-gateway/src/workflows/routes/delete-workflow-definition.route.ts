import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import { deleteWorkflowDefinitionForPrincipal } from "../services/workflow-creator.service.js";
import { workflowErrorStatus } from "../utils.js";

export const deleteWorkflowDefinitionRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const workflowId = context.req.param("workflowId")?.trim();
  if (!workflowId)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Workflow id is required.",
        },
      },
      400,
    );

  try {
    await deleteWorkflowDefinitionForPrincipal(
      context.get("principal"),
      workflowId,
    );
    return context.json({ data: { deleted: true } });
  } catch (error) {
    if (isWorkflowServiceError(error))
      return context.json(
        { error: { code: error.code, message: error.message } },
        workflowErrorStatus(error.code),
      );
    throw error;
  }
};
