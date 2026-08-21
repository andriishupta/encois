import { createReleaseInvestigationBlueprint, parseReleaseInvestigationRequest, type ReleaseInvestigationResponse } from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, startWorkflow, type WorkflowServiceOptions } from "../services/workflow.service.js";

export function createReleaseInvestigationRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseReleaseInvestigationRequest(await context.req.json().catch(() => null));
    if (!request) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "contractVersion, projectKey, and releaseKey are required.",
          },
        },
        400,
      );
    }

    try {
      const workflow = await startWorkflow(
        context.get("principal"),
        {
          workflowType: "encois.user-blueprint.v1",
          version: "1.0.0",
          key: `release-investigation:${request.projectKey}:${request.releaseKey}`,
          idempotencyKey: request.idempotencyKey,
          scope: request.scope,
          blueprint: createReleaseInvestigationBlueprint(request),
          input: {
            projectKey: request.projectKey,
            releaseKey: request.releaseKey,
            ...(request.targetDate ? { targetDate: request.targetDate } : {}),
          },
        },
        context.get("requestId"),
        context.get("traceId"),
        options,
      );

      const response: ReleaseInvestigationResponse = {
        contractVersion: "release-investigation.v1",
        workflow,
        reused: workflow.reused === true,
      };
      return context.json({ data: response }, workflow.reused ? 200 : 202);
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        const status =
          error.code === "FORBIDDEN"
            ? 403
            : error.code === "WORKFLOW_DEFINITION_NOT_FOUND"
              ? 422
              : error.code === "WORKFLOW_PROJECTION_MISSING"
                ? 503
                : error.code === "IDEMPOTENCY_CONFLICT"
                  ? 409
                : 401;
        return context.json({ error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  };
}
