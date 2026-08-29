import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startCoordinatorDispatcher } from "./coordinator-dispatcher.service.js";
import { createWorkflowClient } from "./workflows/temporal-client.js";

const config = loadConfig();
const workflowClient = createWorkflowClient(config);
const app = createApp({ config, workflowClient });

console.info(
  JSON.stringify({
    event: "api_gateway.starting",
    host: config.host,
    port: config.port,
    databaseConfigured: Boolean(process.env.DATABASE_RUNTIME_URL),
    temporalConfigured: Boolean(config.temporalAddress),
    coordinatorDispatcher: true,
  }),
);

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

const stopCoordinatorDispatcher = startCoordinatorDispatcher({
  workflowClient,
  namespace: config.temporalNamespace,
});

const shutdown = () => {
  stopCoordinatorDispatcher();
  server.close(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
