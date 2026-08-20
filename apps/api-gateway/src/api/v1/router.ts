import { Hono } from "hono";
import type { PersistenceDatabase } from "@encois/persistence";
import type { AppConfig } from "../../config.js";
import type { GatewayEnv } from "../../middleware/aos.js";
import { createIntegrationsRouter } from "../../integrations/router.js";
import { webhooksRouter } from "../../webhooks/router.js";
import { createWorkflowsRouter } from "../../workflows/router.js";
import type { WorkflowClient } from "../../workflows/temporal-client.js";

export function createV1Router(options: {
  config?: Pick<AppConfig, "temporalNamespace" | "temporalTaskQueue">;
  database?: PersistenceDatabase;
  workflowClient: WorkflowClient;
}): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.route("/integrations", createIntegrationsRouter(options.database));
  router.route("/workflows", createWorkflowsRouter(options.config ?? { temporalNamespace: "default", temporalTaskQueue: "encois-agent-runtime" }, options));
  router.route("/webhooks", webhooksRouter);
  return router;
}
