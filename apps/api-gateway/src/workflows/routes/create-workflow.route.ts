import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  startWorkflow,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import type { WorkflowStartRequest } from "../types.js";
import { PLATFORM_WORKFLOW_TYPES } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(value: unknown): WorkflowStartRequest | null {
  if (!isRecord(value) || typeof value.workflowType !== "string") return null;
  if (!PLATFORM_WORKFLOW_TYPES.includes(value.workflowType as (typeof PLATFORM_WORKFLOW_TYPES)[number])) return null;

  const request: WorkflowStartRequest = { workflowType: value.workflowType };
  for (const field of ["version", "key"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > 128)) return null;
    if (typeof value[field] === "string") request[field] = value[field];
  }
  if (value.input !== undefined && !isRecord(value.input)) return null;
  if (value.scope !== undefined && !isRecord(value.scope)) return null;
  request.input = value.input as Record<string, unknown> | undefined;
  request.scope = value.scope as Record<string, unknown> | undefined;
  return request;
}

export function createWorkflowRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseRequest(await context.req.json().catch(() => null));
    if (!request) {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "workflowType and a valid workflow payload are required." } },
        400,
      );
    }

    try {
      const data = await startWorkflow(context.get("principal"), request, context.get("requestId"), options);
      return context.json({ data }, 202);
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        const status = error.code === "FORBIDDEN" ? 403 : error.code === "WORKFLOW_DEFINITION_NOT_FOUND" ? 422 : 401;
        return context.json({ error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  };
}
