import type { Handler } from "hono";
import { ContractVersion, validateContract, WorkflowSignalName } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, signalWorkflow, type WorkflowServiceOptions } from "../services/workflow.service.js";
import type { WorkflowSignalRequest } from "../types.js";
import { workflowCommandErrorStatus } from "../utils.js";

function parseSignal(value: unknown): WorkflowSignalRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!validateContract("workflowSignal", value).valid) return null;
  const record = value as Record<string, unknown>;
  if (record.contractVersion !== ContractVersion.WorkflowSignal) return null;
  if (typeof record.signalId !== "string" || record.signalId.trim().length === 0 || record.signalId.length > 128) return null;
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return null;
  const payload = record.payload as Record<string, unknown>;
  if (record.signalName === WorkflowSignalName.BlueprintApproval) {
    if (typeof payload.stepId !== "string" || payload.stepId.trim().length === 0 || typeof payload.approved !== "boolean") return null;
    if (payload.reason !== undefined && (typeof payload.reason !== "string" || payload.reason.length > 2000)) return null;
    return {
      contractVersion: ContractVersion.WorkflowSignal,
      signalName: WorkflowSignalName.BlueprintApproval,
      signalId: record.signalId.trim(),
      payload: { stepId: payload.stepId.trim(), approved: payload.approved, ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}) },
    };
  }
  if (record.signalName === WorkflowSignalName.WorkflowPause || record.signalName === WorkflowSignalName.WorkflowResume) {
    if (Object.keys(payload).some((key) => key !== "reason")) return null;
    if (payload.reason !== undefined && (typeof payload.reason !== "string" || payload.reason.length > 2000)) return null;
    return {
      contractVersion: ContractVersion.WorkflowSignal,
      signalName: record.signalName,
      signalId: record.signalId.trim(),
      payload: typeof payload.reason === "string" ? { reason: payload.reason } : {},
    };
  }
  return null;
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
        return context.json({ error: { code: error.code, message: error.message } }, workflowCommandErrorStatus(error.code));
      }
      throw error;
    }
  };
}
