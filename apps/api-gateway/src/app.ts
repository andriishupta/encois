import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { aosMiddleware, type AosAuthenticator, type GatewayEnv } from "./middleware/aos.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLoggingMiddleware } from "./middleware/request-logging.js";
import { traceContextMiddleware } from "./middleware/trace-context.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import {
  createDatabasePrincipalResolver,
  createIdentityPlatformAuthenticator,
  createInternalServiceAuthenticator,
} from "./auth/identity-platform.js";
import { healthRouter } from "./health/router.js";
import { createIntegrationsRouter } from "./integrations/router.js";
import { webhooksRouter } from "./webhooks/router.js";
import { createWorkflowClient, type WorkflowClient } from "./workflows/temporal-client.js";
import { createWorkflowsRouter } from "./workflows/router.js";
import { createInternalCoordinatorRouter } from "./workflows/internal-coordinator.router.js";

const ACTIVE_API_VERSION = "v1" as const;

export type CreateAppOptions = {
  authenticate?: AosAuthenticator;
  config?: AppConfig;
  workflowClient?: WorkflowClient;
};

export function createApp(options: CreateAppOptions = {}): Hono<GatewayEnv> {
  const config = options.config ?? loadConfig();
  const workflowClient = options.workflowClient ?? createWorkflowClient(config);
  const identityAuthenticator = config.identityPlatformProjectId
    ? createIdentityPlatformAuthenticator({
        projectId: config.identityPlatformProjectId,
        resolvePrincipal: createDatabasePrincipalResolver(),
      })
    : undefined;
  const internalServiceAuthenticator = config.controlPlaneServiceToken
    ? createInternalServiceAuthenticator({
        serviceToken: config.controlPlaneServiceToken,
        serviceUserId: config.controlPlaneServiceUserId,
      })
    : undefined;
  const authenticate =
    options.authenticate ??
    (async (context) => {
      if (context.req.header("X-Encois-Service-Token")) {
        return internalServiceAuthenticator
          ? internalServiceAuthenticator(context)
          : { status: "unconfigured" as const, reason: "control_plane_service_authentication_unconfigured" };
      }
      return identityAuthenticator
        ? identityAuthenticator(context)
        : { status: "unconfigured" as const };
    });
  const app = new Hono<GatewayEnv>();

  app.use("*", requestId());
  app.use("*", traceContextMiddleware);
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
  apiRouter.use("*", aosMiddleware({ authenticate }));

  const v1Router = new Hono<GatewayEnv>();
  v1Router.route("/integrations", createIntegrationsRouter());
  v1Router.route(
    "/workflows",
    createWorkflowsRouter(
      {
        agentGatewayPolicyVersion: config.agentGatewayPolicyVersion,
        temporalNamespace: config.temporalNamespace,
        temporalTaskQueue: config.temporalTaskQueue,
      },
      workflowClient,
    ),
  );
  v1Router.route(
    "/internal/coordinator",
    createInternalCoordinatorRouter(
      {
        agentGatewayPolicyVersion: config.agentGatewayPolicyVersion,
        temporalNamespace: config.temporalNamespace,
        temporalTaskQueue: config.temporalTaskQueue,
        controlPlaneServiceToken: config.controlPlaneServiceToken,
      },
      workflowClient,
    ),
  );
  v1Router.route("/webhooks", webhooksRouter);

  apiRouter.route(`/${ACTIVE_API_VERSION}`, v1Router);
  app.route("/api", apiRouter);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
