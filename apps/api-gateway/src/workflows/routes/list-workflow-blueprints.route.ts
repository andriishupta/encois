import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import { listWorkflowBlueprintsForPrincipal } from "../services/workflow-creator.service.js";
import { authorizationErrorStatus } from "../utils.js";

export const listWorkflowBlueprintsRoute: Handler<GatewayEnv> = async (context) => {
  try {
    return context.json({ data: await listWorkflowBlueprintsForPrincipal(context.get("principal")) });
  } catch (error) {
    if (isWorkflowServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, authorizationErrorStatus(error.code));
    throw error;
  }
};
