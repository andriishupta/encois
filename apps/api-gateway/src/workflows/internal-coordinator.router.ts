import {
  ContractVersion,
  isJsonObject,
  OrganizationOnboardingStatus,
} from "@encois/contracts";
import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { GatewayEnv } from "../middleware/aos.js";
import { internalServiceOnly } from "../middleware/internal-service.js";
import {
  isOrganizationServiceError,
  updateOrganizationOnboardingFromCoordinator,
} from "../organization/services/organization.service.js";
import { createWorkflowRoute } from "./routes/create-workflow.route.js";
import { submitWorkflowPlanRoute } from "./routes/submit-workflow-plan.route.js";
import { validateWorkflowPlanRoute } from "./routes/validate-workflow-plan.route.js";
import type { WorkflowClient } from "./temporal-client.js";

/**
 * Private Runtime -> Gateway control-plane routes. They reuse the same
 * application services as human routes, but require the service credential
 * before authentication and organization-scope checks are evaluated.
 */
export function createInternalCoordinatorRouter(
  config: Pick<
    AppConfig,
    | "agentGatewayPolicyVersion"
    | "agentGatewayCapabilitySecret"
    | "executionCapabilityTtlMs"
    | "temporalNamespace"
    | "temporalTaskQueue"
    | "controlPlaneServiceToken"
  >,
  workflowClient: WorkflowClient,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.use("*", internalServiceOnly(config.controlPlaneServiceToken));
  const options = {
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    policyVersion: config.agentGatewayPolicyVersion,
    capabilitySecret: config.agentGatewayCapabilitySecret,
    capabilityTtlMs: config.executionCapabilityTtlMs,
    workflowClient,
  };

  router.post("/onboarding-status", async (context) => {
    const body = await context.req.json().catch(() => null);
    if (
      !isJsonObject(body) ||
      body.contractVersion !== ContractVersion.Coordinator ||
      typeof body.coordinatorId !== "string" ||
      typeof body.status !== "string"
    ) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message:
              "coordinatorId, status, and coordinator.v1 contractVersion are required.",
          },
        },
        400,
      );
    }
    if (
      body.status !== OrganizationOnboardingStatus.Ready &&
      body.status !== OrganizationOnboardingStatus.Failed
    ) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Coordinator onboarding status must be ready or failed.",
          },
        },
        400,
      );
    }
    if (body.lastError !== undefined && typeof body.lastError !== "string") {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "lastError must be a string when provided.",
          },
        },
        400,
      );
    }
    try {
      const data = await updateOrganizationOnboardingFromCoordinator(
        context.get("principal"),
        {
          coordinatorId: body.coordinatorId.trim(),
          status: body.status,
          ...(typeof body.lastError === "string"
            ? { lastError: body.lastError }
            : {}),
        },
      );
      return context.json({ data });
    } catch (error) {
      if (!isOrganizationServiceError(error)) throw error;
      const status =
        error.code === "DATABASE_UNAVAILABLE"
          ? 503
          : error.code === "FORBIDDEN"
            ? 403
            : error.code.endsWith("_NOT_FOUND")
              ? 404
              : 409;
      return context.json(
        { error: { code: error.code, message: error.message } },
        status,
      );
    }
  });

  router.post("/plans", submitWorkflowPlanRoute());
  router.post("/plans/validate", validateWorkflowPlanRoute(options));
  router.post(
    "/workflows",
    createWorkflowRoute(options, { requireApprovedBlueprintReference: true }),
  );
  return router;
}
