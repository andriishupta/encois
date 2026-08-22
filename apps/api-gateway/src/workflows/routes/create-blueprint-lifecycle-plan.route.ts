import type { Handler } from "hono";
import { isJsonObject, validateContract, type WorkflowBlueprintLifecycleRequest } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { createBlueprintLifecyclePlan } from "../services/blueprint-lifecycle.service.js";
import { isWorkflowPlanServiceError } from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus, workflowResponseStatus } from "../utils.js";

function parseRequest(value: unknown): WorkflowBlueprintLifecycleRequest | null {
  return isJsonObject(value) && validateContract("workflowBlueprintLifecycle", value).valid
    ? value as unknown as WorkflowBlueprintLifecycleRequest
    : null;
}

export const createBlueprintLifecyclePlanRoute: Handler<GatewayEnv> = async (context) => {
  const request = parseRequest(await context.req.json().catch(() => null));
  if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid Blueprint lifecycle request is required." } }, 400);
  try {
    const blueprintId = context.req.param("blueprintId")?.trim();
    if (!blueprintId) return context.json({ error: { code: "INVALID_REQUEST", message: "Blueprint id is required." } }, 400);
    const data = await createBlueprintLifecyclePlan(context.get("principal"), blueprintId, request);
    return context.json({ data }, workflowResponseStatus(data.status));
  } catch (error) {
    if (isWorkflowPlanServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, workflowPlanErrorStatus(error.code, 422));
    throw error;
  }
};
