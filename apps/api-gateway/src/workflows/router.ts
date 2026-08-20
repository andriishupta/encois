import { Hono } from "hono";
import type { PersistenceDatabase } from "@encois/persistence";
import type { GatewayEnv } from "../middleware/aos.js";
import type { WorkflowClient } from "./temporal-client.js";
import { createWorkflowRoute } from "./routes/create-workflow.route.js";
import { getWorkflowRoute } from "./routes/get-workflow.route.js";
import { WorkflowService } from "./services/workflow.service.js";
import type { AppConfig } from "../config.js";

export function createWorkflowsRouter(
  config: Pick<AppConfig, "temporalNamespace" | "temporalTaskQueue">,
  options: { database?: PersistenceDatabase; workflowClient: WorkflowClient },
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  const service = new WorkflowService(
    options.workflowClient,
    config.temporalNamespace,
    config.temporalTaskQueue,
    options.database,
  );

  router.post("/", createWorkflowRoute(service));
  router.get("/:workflowId", getWorkflowRoute(service));
  return router;
}

