import type { Handler } from "hono";
import { isJsonObject, parseWorkflowBlueprint, TemporalWorkflowType } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  startWorkflow,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import type { WorkflowStartRequest } from "../types.js";
import {
  isTemporalWorkflowType,
  readOptionalRecord,
  readOptionalString,
  workflowErrorStatus,
  workflowStartResponseStatus,
} from "../utils.js";

function parseRequest(value: unknown): WorkflowStartRequest | null {
  if (!isJsonObject(value) || typeof value.workflowType !== "string") return null;
  if (!isTemporalWorkflowType(value.workflowType)) return null;
  // Source ingestion is a platform-owned workflow. It is launched only after
  // a persisted Source + Revision pass the source-specific authorization and
  // provenance checks; it must not be accepted as a user Blueprint payload.
  if (value.workflowType === TemporalWorkflowType.SourceIngestion) return null;

  const request: WorkflowStartRequest = { workflowType: value.workflowType };
  for (const field of ["version", "key", "blueprintId", "blueprintVersion"] as const) {
    const candidate = readOptionalString(value, field);
    if (candidate === null) return null;
    if (candidate !== undefined) request[field] = candidate;
  }
  const input = readOptionalRecord(value, "input");
  const scope = readOptionalRecord(value, "scope");
  const idempotencyKey = readOptionalString(value, "idempotencyKey");
  if (input === null || scope === null || idempotencyKey === null) return null;
  const blueprintCandidate = value.blueprint ?? input?.blueprint;
  const blueprint = blueprintCandidate === undefined ? undefined : parseWorkflowBlueprint(blueprintCandidate);
  if (blueprintCandidate !== undefined && !blueprint) return null;
  if (blueprint && typeof value.blueprintId === "string" && value.blueprintId !== blueprint.blueprintId) return null;
  if (blueprint && typeof value.blueprintVersion === "string" && value.blueprintVersion !== blueprint.version) return null;
  if (
    (value.blueprintId !== undefined || value.blueprintVersion !== undefined) &&
    value.workflowType !== TemporalWorkflowType.UserBlueprint
  ) return null;
  request.input = input ?? undefined;
  request.scope = scope as WorkflowStartRequest["scope"];
  request.blueprint = blueprint ?? undefined;
  request.blueprintId = readOptionalString(value, "blueprintId") ?? undefined;
  request.blueprintVersion = readOptionalString(value, "blueprintVersion") ?? undefined;
  request.idempotencyKey = idempotencyKey ?? undefined;
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
      return context.json({ data }, workflowStartResponseStatus(data.reused));
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        return context.json({ error: { code: error.code, message: error.message } }, workflowErrorStatus(error.code));
      }
      throw error;
    }
  };
}
