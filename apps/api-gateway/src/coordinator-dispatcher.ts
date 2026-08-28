import { loadConfig } from "./config.js";
import {
  createCoordinatorEventSink,
  dispatchCoordinatorOutbox,
} from "./workflows/services/coordinator-outbox.service.js";
import { createWorkflowClient } from "./workflows/temporal-client.js";

const config = loadConfig();
const workflowClient = createWorkflowClient(config);
const result = await dispatchCoordinatorOutbox({
  limit: Number(process.env.COORDINATOR_DISPATCH_LIMIT ?? 20),
  sink: createCoordinatorEventSink(workflowClient, config.temporalNamespace),
});

console.info(
  JSON.stringify({
    event: "coordinator_outbox.dispatch_completed",
    ...result,
  }),
);

if (result.status === "database-unavailable") {
  process.exitCode = 2;
}
