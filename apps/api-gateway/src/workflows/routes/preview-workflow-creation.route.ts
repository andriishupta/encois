import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import { previewWorkflowCreation } from "../services/workflow-creator.service.js";
import { parseWorkflowCreationIntent } from "./parse-workflow-creation-intent.js";
import { workflowPlanErrorStatus } from "../utils.js";

export const previewWorkflowCreationRoute: Handler<GatewayEnv> = async (context) => {
  const intent = parseWorkflowCreationIntent(await context.req.json().catch(() => null));
  if (!intent) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid workflow creation intent is required." } }, 400);
  try {
    const data = await previewWorkflowCreation(context.get("principal"), intent);
    return context.json({ data });
  } catch (error) {
    if (isWorkflowServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, workflowPlanErrorStatus(error.code, 422));
    throw error;
  }
};
