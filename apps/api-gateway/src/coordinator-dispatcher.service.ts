import {
  createCoordinatorEventSink,
  dispatchCoordinatorOutbox,
} from "./workflows/services/coordinator-outbox.service.js";
import type { WorkflowClient } from "./workflows/temporal-client.js";

const defaultPollIntervalMs = 1_000;
const unavailableLogIntervalMs = 10_000;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

export type CoordinatorDispatcherOptions = {
  workflowClient: WorkflowClient;
  namespace: string;
  intervalMs?: number;
  limit?: number;
};

/**
 * Runs the coordinator outbox delivery loop in the API Gateway process. The
 * loop is deliberately best-effort: database and Temporal outages are logged
 * and retried, while the HTTP server remains available.
 */
export function startCoordinatorDispatcher(
  options: CoordinatorDispatcherOptions,
): () => void {
  let stopped = false;
  let lastUnavailableLogAt = 0;
  const intervalMs = Math.max(250, options.intervalMs ?? defaultPollIntervalMs);
  const sink = createCoordinatorEventSink(
    options.workflowClient,
    options.namespace,
  );

  console.info(
    JSON.stringify({
      event: "coordinator_outbox.dispatcher_started",
      intervalMs,
    }),
  );

  const run = async (): Promise<void> => {
    while (!stopped) {
      const startedAt = Date.now();
      try {
        const result = await dispatchCoordinatorOutbox({
          limit: options.limit,
          sink,
        });

        if (result.claimed > 0 || result.failed > 0) {
          console.info(
            JSON.stringify({
              event: "coordinator_outbox.dispatch_completed",
              ...result,
            }),
          );
        }

        if (
          result.status === "database-unavailable" &&
          Date.now() - lastUnavailableLogAt >= unavailableLogIntervalMs
        ) {
          lastUnavailableLogAt = Date.now();
          console.error(
            JSON.stringify({
              event: "coordinator_outbox.dispatch_unavailable",
              reason: "database-unavailable",
              retrying: true,
            }),
          );
        }
      } catch (error) {
        if (Date.now() - lastUnavailableLogAt >= unavailableLogIntervalMs) {
          lastUnavailableLogAt = Date.now();
          console.error(
            JSON.stringify({
              event: "coordinator_outbox.dispatch_error",
              error: errorMessage(error),
              retrying: true,
            }),
          );
        }
      }

      const remainingDelay = Math.max(0, intervalMs - (Date.now() - startedAt));
      if (stopped) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remainingDelay);
      });
    }
  };

  void run().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "coordinator_outbox.dispatcher_stopped_unexpectedly",
        error: errorMessage(error),
      }),
    );
  });

  return () => {
    stopped = true;
    console.info(
      JSON.stringify({ event: "coordinator_outbox.dispatcher_stopping" }),
    );
  };
}
