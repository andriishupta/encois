import type { Handler } from "hono";
import { isRecord, parseWorkflowBlueprint } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  startWorkflow,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import type { WorkflowStartRequest } from "../types.js";
import { PLATFORM_WORKFLOW_TYPES, USER_BLUEPRINT_WORKFLOW_TYPE } from "../types.js";

function parseRequest(value: unknown): WorkflowStartRequest | null {
  if (!isRecord(value) || typeof value.workflowType !== "string") return null;
  if (!PLATFORM_WORKFLOW_TYPES.includes(value.workflowType as (typeof PLATFORM_WORKFLOW_TYPES)[number])) return null;

  const request: WorkflowStartRequest = { workflowType: value.workflowType };
  for (const field of ["version", "key", "blueprintId", "blueprintVersion"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > 128)) return null;
    if (typeof value[field] === "string") request[field] = value[field];
  }
  if (value.input !== undefined && !isRecord(value.input)) return null;
  if (value.scope !== undefined && !isRecord(value.scope)) return null;
  if (value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== "string" || value.idempotencyKey.length > 128)) return null;
  const input = value.input as Record<string, unknown> | undefined;
  const blueprintCandidate = value.blueprint ?? input?.blueprint;
  const blueprint = blueprintCandidate === undefined ? undefined : parseWorkflowBlueprint(blueprintCandidate);
  if (blueprintCandidate !== undefined && !blueprint) return null;
  if (blueprint && typeof value.blueprintId === "string" && value.blueprintId !== blueprint.blueprintId) return null;
  if (blueprint && typeof value.blueprintVersion === "string" && value.blueprintVersion !== blueprint.version) return null;
  if ((value.blueprintId !== undefined || value.blueprintVersion !== undefined) && value.workflowType !== USER_BLUEPRINT_WORKFLOW_TYPE) return null;
  request.input = value.input as Record<string, unknown> | undefined;
  request.scope = value.scope as Record<string, unknown> | undefined;
  request.blueprint = blueprint ?? undefined;
  request.blueprintId = typeof value.blueprintId === "string" ? value.blueprintId : undefined;
  request.blueprintVersion = typeof value.blueprintVersion === "string" ? value.blueprintVersion : undefined;
  request.idempotencyKey = typeof value.idempotencyKey === "string" ? value.idempotencyKey : undefined;
  return request;
}

export function createWorkflowRoute(
  options: WorkflowServiceOptions,
  routeOptions: { requireApprovedBlueprintReference?: boolean } = {},
): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseRequest(await context.req.json().catch(() => null));
    if (!request) {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "workflowType and a valid workflow payload are required." } },
        400,
      );
    }
    if (
      routeOptions.requireApprovedBlueprintReference &&
      (!request.blueprintId || !request.blueprintVersion || request.blueprint)
    ) {
      return context.json(
        {
          error: {
            code: "BLUEPRINT_REGISTRY_REFERENCE_REQUIRED",
            message: "The private Coordinator route accepts only an approved Blueprint registry reference.",
          },
        },
        422,
      );
    }

    try {
      const data = await startWorkflow(context.get("principal"), request, context.get("requestId"), context.get("traceId"), options);
      return context.json({ data }, 202);
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        const status =
          error.code === "FORBIDDEN"
            ? 403
            : [
                  "WORKFLOW_DEFINITION_NOT_FOUND",
                  "BLUEPRINT_VERSION_REQUIRED",
                  "BLUEPRINT_NOT_FOUND",
                  "BLUEPRINT_INVALID",
                ].includes(error.code)
              ? 422
              : ["PERSISTENCE_UNAVAILABLE", "BLUEPRINT_REGISTRY_UNAVAILABLE"].includes(error.code)
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
