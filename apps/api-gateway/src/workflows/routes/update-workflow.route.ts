import {
  ContractVersion,
  validateContract,
  WorkflowUpdateName,
  type WorkflowUpdateRequest,
} from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowServiceError,
  updateWorkflow,
  type WorkflowServiceOptions,
} from "../services/workflow.service.js";
import { workflowCommandErrorStatus } from "../utils.js";

function parseUpdate(value: unknown): WorkflowUpdateRequest | null {
  if (!validateContract("workflowUpdate", value).valid) return null;
  const record = value as Record<string, unknown>;
  const payload = record.payload as Record<string, unknown>;
  return {
    contractVersion: ContractVersion.WorkflowUpdate,
    updateName: WorkflowUpdateName.BlueprintContext,
    updateId: (record.updateId as string).trim(),
    payload: {
      businessInput: payload.businessInput as Record<string, unknown>,
      ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
    },
  };
}

export function updateWorkflowRoute(
  options: WorkflowServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseUpdate(await context.req.json().catch(() => null));
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid workflow Update is required.",
          },
        },
        400,
      );
    const workflowId = context.req.param("workflowId");
    if (!workflowId)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Workflow id is required.",
          },
        },
        400,
      );
    try {
      await updateWorkflow(
        context.get("principal"),
        workflowId,
        request,
        options,
      );
      return context.json({
        data: { accepted: true, updateId: request.updateId },
      });
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          workflowCommandErrorStatus(error.code),
        );
      }
      throw error;
    }
  };
}
