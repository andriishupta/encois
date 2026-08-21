import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import { internalServiceOnly } from "../middleware/internal-service.js";
import type { AppConfig } from "../config.js";
import type { WorkflowClient } from "./temporal-client.js";
import { createWorkflowRoute } from "./routes/create-workflow.route.js";
import { submitWorkflowPlanRoute } from "./routes/submit-workflow-plan.route.js";
import { validateWorkflowPlanRoute } from "./routes/validate-workflow-plan.route.js";

/**
 * Private Runtime -> Gateway control-plane routes. They reuse the same
 * application services as human routes, but require the service credential
 * before authentication and organization-scope checks are evaluated.
 */
export function createInternalCoordinatorRouter(
  config: Pick<AppConfig, "agentGatewayPolicyVersion" | "temporalNamespace" | "temporalTaskQueue" | "controlPlaneServiceToken">,
  workflowClient: WorkflowClient,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.use("*", internalServiceOnly(config.controlPlaneServiceToken));
  const options = {
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    policyVersion: config.agentGatewayPolicyVersion,
    workflowClient,
  };

  router.post("/plans", submitWorkflowPlanRoute());
  router.post("/plans/validate", validateWorkflowPlanRoute(options));
  router.post("/workflows", createWorkflowRoute(options, { requireApprovedBlueprintReference: true }));
  return router;
}
