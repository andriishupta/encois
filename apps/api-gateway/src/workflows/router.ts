import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import type { WorkflowClient } from "./temporal-client.js";
import { createWorkflowRoute } from "./routes/create-workflow.route.js";
import { getWorkflowRoute } from "./routes/get-workflow.route.js";
import { createReleaseInvestigationRoute } from "./routes/release-investigation.route.js";
import { listWorkflowsRoute } from "./routes/list-workflows.route.js";
import { signalWorkflowRoute } from "./routes/signal-workflow.route.js";
import { updateWorkflowRoute } from "./routes/update-workflow.route.js";
import { validateWorkflowPlanRoute } from "./routes/validate-workflow-plan.route.js";
import { submitWorkflowPlanRoute } from "./routes/submit-workflow-plan.route.js";
import { approveWorkflowPlanRoute } from "./routes/approve-workflow-plan.route.js";
import { applyWorkflowPlanRoute } from "./routes/apply-workflow-plan.route.js";
import type { AppConfig } from "../config.js";

export function createWorkflowsRouter(
  config: Pick<AppConfig, "agentGatewayPolicyVersion" | "temporalNamespace" | "temporalTaskQueue">,
  workflowClient: WorkflowClient,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  const options = {
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    policyVersion: config.agentGatewayPolicyVersion,
    workflowClient,
  };

  router.post("/", createWorkflowRoute(options));
  router.post("/release-investigations", createReleaseInvestigationRoute(options));
  router.post("/plans", submitWorkflowPlanRoute());
  router.post("/plans/validate", validateWorkflowPlanRoute(options));
  router.post("/plans/:planId/approve", approveWorkflowPlanRoute());
  router.post("/plans/:planId/apply", applyWorkflowPlanRoute(options));
  router.get("/", listWorkflowsRoute(options));
  router.post("/:workflowId/signals", signalWorkflowRoute(options));
  router.post("/:workflowId/updates", updateWorkflowRoute(options));
  router.get("/:workflowId", getWorkflowRoute(options));
  return router;
}
