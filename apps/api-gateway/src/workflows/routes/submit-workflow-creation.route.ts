import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import {
  assertWorkflowProviderBindingsReady,
  previewWorkflowCreation,
} from "../services/workflow-creator.service.js";
import {
  isWorkflowPlanServiceError,
  submitWorkflowPlan,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus, workflowResponseStatus } from "../utils.js";
import { parseWorkflowCreationIntent } from "./parse-workflow-creation-intent.js";

export const submitWorkflowCreationRoute: Handler<GatewayEnv> = async (
  context,
) => {
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
    const preview = await previewWorkflowCreation(
      context.get("principal"),
      intent,
    );
    assertWorkflowProviderBindingsReady(preview.providerBindings);
    const data = await submitWorkflowPlan(
      context.get("principal"),
      preview.plan,
    );
    return context.json({ data }, workflowResponseStatus(data.status));
  } catch (error) {
    if (isWorkflowPlanServiceError(error) || isWorkflowServiceError(error))
      return context.json(
        { error: { code: error.code, message: error.message } },
        workflowPlanErrorStatus(error.code, 422),
      );
    throw error;
  }
};
