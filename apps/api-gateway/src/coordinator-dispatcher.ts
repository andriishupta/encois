import { loadConfig } from "./config.js";
import {
  createCoordinatorEventSink,
  dispatchCoordinatorOutbox,
} from "./workflows/services/coordinator-outbox.service.js";
import { createWorkflowClient } from "./workflows/temporal-client.js";

const organizationId = process.env.COORDINATOR_DISPATCH_ORGANIZATION_ID?.trim();
if (!organizationId) {
  throw new Error(
    "COORDINATOR_DISPATCH_ORGANIZATION_ID is required for the dispatcher job.",
  );
}

const config = loadConfig();
const workflowClient = createWorkflowClient(config);
const result = await dispatchCoordinatorOutbox({
  organizationId,
  limit: Number(process.env.COORDINATOR_DISPATCH_LIMIT ?? 20),
  sink: createCoordinatorEventSink(workflowClient, config.temporalNamespace),
});

console.info(
  JSON.stringify({
    event: "coordinator_outbox.dispatch_completed",
    organizationId,
    ...result,
  }),
);

if (result.status === "persistence-unavailable") {
  process.exitCode = 2;
}
