import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { GatewayEnv } from "../middleware/aos.js";
import { cancelWorkflowRoute } from "./routes/cancel-workflow.route.js";
import { createWorkflowRoute } from "./routes/create-workflow.route.js";
import { deleteWorkflowBlueprintRoute } from "./routes/delete-workflow-blueprint.route.js";
import { deleteWorkflowDefinitionRoute } from "./routes/delete-workflow-definition.route.js";
import { getWorkflowRoute } from "./routes/get-workflow.route.js";
import { getWorkflowEventsRoute } from "./routes/get-workflow-events.route.js";
import { listWorkflowActivityRoute } from "./routes/list-workflow-activity.route.js";
import { listWorkflowBlueprintsRoute } from "./routes/list-workflow-blueprints.route.js";
import { listWorkflowTemplatesRoute } from "./routes/list-workflow-templates.route.js";
import { listWorkflowsRoute } from "./routes/list-workflows.route.js";
import { previewWorkflowCreationRoute } from "./routes/preview-workflow-creation.route.js";
import { rerunWorkflowRoute } from "./routes/rerun-workflow.route.js";
import { signalWorkflowRoute } from "./routes/signal-workflow.route.js";
import { submitWorkflowCreationRoute } from "./routes/submit-workflow-creation.route.js";
import { updateWorkflowRoute } from "./routes/update-workflow.route.js";
import type { WorkflowClient } from "./temporal-client.js";

export function createWorkflowsRouter(
  config: Pick<
    AppConfig,
    | "agentGatewayPolicyVersion"
    | "agentGatewayCapabilitySecret"
    | "executionCapabilityTtlMs"
    | "temporalNamespace"
    | "temporalTaskQueue"
    | "workflowRunRetentionDays"
  >,
  workflowClient: WorkflowClient,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  const options = {
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    policyVersion: config.agentGatewayPolicyVersion,
    capabilitySecret: config.agentGatewayCapabilitySecret,
    capabilityTtlMs: config.executionCapabilityTtlMs,
    workflowRunRetentionDays: config.workflowRunRetentionDays,
    workflowClient,
  };

  router.post("/", createWorkflowRoute(options));
  router.post("/blueprints/preview", previewWorkflowCreationRoute);
  router.post("/blueprints/from-intent", submitWorkflowCreationRoute(options));
  router.get("/templates", listWorkflowTemplatesRoute);
  router.get("/blueprints", listWorkflowBlueprintsRoute);
  router.delete(
    "/blueprints/:blueprintId/:version",
    deleteWorkflowBlueprintRoute,
  );
  router.get("/activity", listWorkflowActivityRoute(options));
  router.get("/", listWorkflowsRoute(options));
  router.delete("/definitions/:workflowId", deleteWorkflowDefinitionRoute);
  router.post("/:workflowId/cancel", cancelWorkflowRoute(options));
  router.post("/:workflowId/rerun", rerunWorkflowRoute(options));
  router.post("/:workflowId/signals", signalWorkflowRoute(options));
  router.post("/:workflowId/updates", updateWorkflowRoute(options));
  router.get("/:workflowId/events", getWorkflowEventsRoute(options));
  router.get("/:workflowId", getWorkflowRoute(options));
  return router;
}
