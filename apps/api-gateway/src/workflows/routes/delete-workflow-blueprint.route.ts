import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import { deleteWorkflowBlueprintRevisionForPrincipal } from "../services/workflow-creator.service.js";
import { workflowErrorStatus } from "../utils.js";

export const deleteWorkflowBlueprintRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const blueprintId = context.req.param("blueprintId")?.trim();
  const version = context.req.param("version")?.trim();
  if (!blueprintId || !version)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Blueprint id and version are required.",
        },
      },
      400,
    );

  try {
    await deleteWorkflowBlueprintRevisionForPrincipal(
      context.get("principal"),
      blueprintId,
      version,
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
