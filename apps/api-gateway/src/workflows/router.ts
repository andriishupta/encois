import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import type { WorkflowClient } from "./temporal-client.js";
import { createWorkflowRoute } from "./routes/create-workflow.route.js";
import { getWorkflowRoute } from "./routes/get-workflow.route.js";
import type { AppConfig } from "../config.js";

export function createWorkflowsRouter(
  config: Pick<AppConfig, "temporalNamespace" | "temporalTaskQueue">,
  workflowClient: WorkflowClient,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  const options = {
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    workflowClient,
  };

  router.post("/", createWorkflowRoute(options));
  router.get("/:workflowId", getWorkflowRoute(options));
  return router;
}
