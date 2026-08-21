import type { Handler } from "hono";
import { validateContract } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, signalWorkflow, type WorkflowServiceOptions } from "../services/workflow.service.js";
import type { WorkflowSignalRequest } from "../types.js";

function parseSignal(value: unknown): WorkflowSignalRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!validateContract("workflowSignal", value).valid) return null;
  const record = value as Record<string, unknown>;
  if (record.contractVersion !== "workflow-signal.v1" || record.signalName !== "blueprint-approval") return null;
  if (typeof record.signalId !== "string" || record.signalId.trim().length === 0 || record.signalId.length > 128) return null;
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return null;
  const payload = record.payload as Record<string, unknown>;
  if (typeof payload.stepId !== "string" || payload.stepId.trim().length === 0 || typeof payload.approved !== "boolean") return null;
  if (payload.reason !== undefined && typeof payload.reason !== "string") return null;
  return {
    contractVersion: "workflow-signal.v1",
    signalName: "blueprint-approval",
    signalId: record.signalId.trim(),
    payload,
  };
}

export function signalWorkflowRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseSignal(await context.req.json().catch(() => null));
    if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid workflow Signal is required." } }, 400);
    const workflowId = context.req.param("workflowId");
    if (!workflowId) return context.json({ error: { code: "INVALID_REQUEST", message: "Workflow id is required." } }, 400);
    try {
      await signalWorkflow(context.get("principal"), workflowId, request, options);
      return context.json({ data: { accepted: true } });
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        const status =
          error.code === "WORKFLOW_NOT_FOUND"
            ? 404
            : error.code === "FORBIDDEN"
              ? 403
              : error.code === "WORKFLOW_NOT_SIGNALABLE"
                ? 409
                : error.code === "WORKFLOW_SIGNAL_CONFLICT"
                  ? 409
                : 503;
        return context.json({ error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  };
}
