import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { aosMiddleware, type AosAuthenticator, type GatewayEnv } from "./middleware/aos.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLoggingMiddleware } from "./middleware/request-logging.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { healthRouter } from "./health/router.js";
import { createV1Router } from "./api/v1/router.js";
import type { PersistenceDatabase } from "@encois/persistence";
import { createWorkflowClient, type WorkflowClient } from "./workflows/temporal-client.js";

export type CreateAppOptions = {
  authenticate?: AosAuthenticator;
  config?: AppConfig;
  database?: PersistenceDatabase;
  workflowClient?: WorkflowClient;
};

export function createApp(options: CreateAppOptions = {}): Hono<GatewayEnv> {
  const config = options.config ?? loadConfig();
  const workflowClient = options.workflowClient ?? createWorkflowClient(config);
  const app = new Hono<GatewayEnv>();

  app.use("*", requestId());
  app.use("*", requestLoggingMiddleware);
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      credentials: config.corsCredentials,
      origin: (origin) => (config.corsOrigins.includes(origin) ? origin : undefined),
    }),
  );
  app.use("*", bodyLimit({ maxSize: config.bodyLimitBytes }));
  app.use("*", timeout(config.requestTimeoutMs));

  app.get("/", (context) =>
    context.json({
      data: {
        name: "encois-api-gateway",
        status: "ok",
      },
    }),
  );
  app.route("/health", healthRouter);

  const apiRouter = new Hono<GatewayEnv>();
  apiRouter.use("*", aosMiddleware({ authenticate: options.authenticate }));
  apiRouter.route(
    "/v1",
    createV1Router({
      config,
      database: options.database,
      workflowClient,
    }),
  );
  app.route("/api", apiRouter);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
