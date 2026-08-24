import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  deleteWorkflowBlueprintForPrincipal,
} from "../services/workflow-creator.service.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import { workflowPlanErrorStatus } from "../utils.js";

export const deleteWorkflowBlueprintRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const blueprintId = context.req.param("blueprintId")?.trim();
  if (!blueprintId)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Blueprint id is required.",
        },
      },
      400,
    );

  try {
    await deleteWorkflowBlueprintForPrincipal(
      context.get("principal"),
      blueprintId,
    );
    return context.json({ data: { deleted: true } });
  } catch (error) {
    if (isWorkflowServiceError(error))
      return context.json(
        { error: { code: error.code, message: error.message } },
        workflowPlanErrorStatus(error.code),
      );
    throw error;
  }
};
