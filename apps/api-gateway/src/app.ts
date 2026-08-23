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
  createDatabaseAccessResolver,
  createDatabasePrincipalResolver,
  createIdentityPlatformAuthenticator,
  createIdentityPlatformIdentityVerifier,
  createInternalServiceAuthenticator,
  type IdentityAccessResolver,
  type IdentityPlatformVerifier,
} from "./auth/identity-platform.js";
import { createAuthRouter } from "./auth/router.js";
import { createHealthRouter } from "./health/router.js";
import { createPublicRouter } from "./public/router.js";
import { createIntegrationsRouter } from "./integrations/router.js";
import { createInternalIntegrationsRouter } from "./integrations/routes/internal.js";
import { createWebhooksRouter } from "./webhooks/router.js";
import { createWebhookPayloadStore } from "./webhooks/payload-store.js";
import { createWebhookSecretResolver } from "./webhooks/secret-resolver.js";
import { createWebhookSecretWriter } from "./security/secret-manager.js";
import type { WebhookEndpointServiceOptions } from "./integrations/services/webhook-endpoint.service.js";
import { createWorkflowClient, type WorkflowClient } from "./workflows/temporal-client.js";
import { createWorkflowsRouter } from "./workflows/router.js";
import { createInternalCoordinatorRouter } from "./workflows/internal-coordinator.router.js";
import { createOrganizationRouter } from "./organization/router.js";
import { createSourcesRouter } from "./sources/router.js";
import { createSourceArtifactStore } from "./sources/artifact-store.js";
import type { SourceArtifactStore } from "./sources/services/source.service.js";
import { createGraphGatewayClient, type GraphGatewayClient } from "./context/graph-client.js";
import { queryGraphRoute } from "./context/routes/query-graph.route.js";
import { createMemoryRuntimeClient } from "./context/memory-client.js";
import { queryMemoryRoute } from "./context/routes/query-memory.route.js";
import { createMemoryChangesRouter } from "./context/memory-changes.router.js";
import { createInvestigationsRouter, createNotificationPreferencesRouter, createNotificationsRouter } from "./investigations/router.js";
import type { IntegrationAuthorizationAdapter } from "./integrations/authorization-adapter.js";
import { createOAuthIntegrationAuthorizationAdapter } from "./integrations/oauth-authorization-adapter.js";
import { createAuthorizationCallbackRoute } from "./integrations/routes/authorization-callback.route.js";

const ACTIVE_API_VERSION = "v1" as const;

export type CreateAppOptions = {
  authenticate?: AosAuthenticator;
  config?: AppConfig;
  resolveAccess?: IdentityAccessResolver;
  verifyIdentity?: IdentityPlatformVerifier;
  workflowClient?: WorkflowClient;
  sourceArtifactStore?: SourceArtifactStore;
  graphClient?: GraphGatewayClient;
  integrationAuthorizationAdapter?: IntegrationAuthorizationAdapter;
  webhookPayloadStore?: import("./webhooks/payload-store.js").WebhookPayloadStore;
  webhookSecretResolver?: import("./webhooks/secret-resolver.js").WebhookSecretResolver;
  webhookSecretWriter?: import("./security/secret-manager.js").WebhookSecretWriter;
};

export function createApp(options: CreateAppOptions = {}): Hono<GatewayEnv> {
  const config = options.config ?? loadConfig();
  const localWebhookSecrets = new Map<string, string>();
  if (config.nodeEnv === "production" && !config.agentGatewayCapabilitySecret) {
    throw new Error("AGENT_GATEWAY_CAPABILITY_SECRET is required in production.");
  }
  const workflowClient = options.workflowClient ?? createWorkflowClient(config);
  const webhookPayloadStore = options.webhookPayloadStore ?? createWebhookPayloadStore({
    bucketName: config.sourceArtifactBucket,
    nodeEnv: config.nodeEnv,
    projectId: config.identityPlatformProjectId,
  });
  if (config.nodeEnv === "production" && !webhookPayloadStore) {
    throw new Error("SOURCE_ARTIFACT_BUCKET is required in production for webhook payload retention.");
  }
  const webhookSecretResolver = options.webhookSecretResolver ?? createWebhookSecretResolver({
    nodeEnv: config.nodeEnv,
    projectId: config.identityPlatformProjectId,
    localSecrets: localWebhookSecrets,
  });
  const webhookSecretWriter = options.webhookSecretWriter ?? createWebhookSecretWriter({
    nodeEnv: config.nodeEnv,
    projectId: config.identityPlatformProjectId,
    localSecrets: localWebhookSecrets,
  });
  const webhookEndpointOptions: WebhookEndpointServiceOptions = {
    secretWriter: webhookSecretWriter,
    publicBaseUrl: config.publicBaseUrl,
  };
  const configuredOAuthFields = [config.integrationOAuthConfigJson, config.integrationOAuthCallbackUrl, config.integrationOAuthStateSecret];
  const hasOAuthConfiguration = configuredOAuthFields.some(Boolean);
  if (hasOAuthConfiguration && configuredOAuthFields.some((value) => !value)) {
    throw new Error("ENCOIS_INTEGRATION_OAUTH_CONFIG_JSON, ENCOIS_INTEGRATION_OAUTH_CALLBACK_URL, and ENCOIS_INTEGRATION_OAUTH_STATE_SECRET must be configured together.");
  }
  const integrationAuthorizationAdapter = options.integrationAuthorizationAdapter ?? (config.integrationOAuthConfigJson && config.integrationOAuthCallbackUrl && config.integrationOAuthStateSecret
    ? createOAuthIntegrationAuthorizationAdapter({
        configJson: config.integrationOAuthConfigJson,
        callbackUrl: config.integrationOAuthCallbackUrl,
        stateSecret: config.integrationOAuthStateSecret,
        projectId: config.identityPlatformProjectId,
        accessorServiceAccount: config.agentGatewayServiceAccountEmail,
      })
    : undefined);
  const graphClient = options.graphClient ?? (config.agentGatewayUrl && config.agentGatewayServiceToken
    ? createGraphGatewayClient({
        baseUrl: config.agentGatewayUrl,
        serviceToken: config.agentGatewayServiceToken,
        audience: config.agentGatewayAudience,
        timeoutMs: config.requestTimeoutMs,
      })
    : undefined);
  const memoryClient = config.agentRuntimeUrl && config.agentRuntimeServiceToken
    ? createMemoryRuntimeClient({
        baseUrl: config.agentRuntimeUrl,
        serviceToken: config.agentRuntimeServiceToken,
        audience: config.agentRuntimeAudience,
        timeoutMs: config.requestTimeoutMs,
      })
    : undefined;
  const identityVerifier =
    options.verifyIdentity ??
    (config.identityPlatformProjectId
      ? createIdentityPlatformIdentityVerifier({
          allowedSignInProviders: config.identityPlatformAllowedSignInProviders,
          projectId: config.identityPlatformProjectId,
        })
      : undefined);
  const accessResolver = options.resolveAccess ?? createDatabaseAccessResolver();
  const identityAuthenticator = config.identityPlatformProjectId
    ? createIdentityPlatformAuthenticator({
        allowedSignInProviders: config.identityPlatformAllowedSignInProviders,
        projectId: config.identityPlatformProjectId,
        resolvePrincipal: createDatabasePrincipalResolver(),
      })
    : undefined;
  const internalServiceAuthenticator = config.controlPlaneServiceToken
    ? createInternalServiceAuthenticator({
        allowDatabaseScopeFallback: config.nodeEnv === "development" || config.nodeEnv === "test",
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
  app.route("/health", createHealthRouter(config));
  app.route("/healthz", createHealthRouter(config));

  const apiRouter = new Hono<GatewayEnv>();
  apiRouter.route(`/${ACTIVE_API_VERSION}/auth`, createAuthRouter({ resolveAccess: accessResolver, verifyIdentity: identityVerifier }));
  apiRouter.route(`/${ACTIVE_API_VERSION}/public`, createPublicRouter());
  apiRouter.route(`/${ACTIVE_API_VERSION}/integrations`, new Hono<GatewayEnv>().get("/authorization/callback", createAuthorizationCallbackRoute(integrationAuthorizationAdapter, config.integrationOAuthSuccessUrl)));
  apiRouter.route(`/${ACTIVE_API_VERSION}/webhooks`, createWebhooksRouter({
    secretResolver: webhookSecretResolver,
    payloadStore: webhookPayloadStore,
    sourceService: {
      namespace: config.temporalNamespace,
      taskQueue: config.temporalTaskQueue,
      policyVersion: config.agentGatewayPolicyVersion,
      capabilitySecret: config.agentGatewayCapabilitySecret,
      capabilityTtlMs: config.executionCapabilityTtlMs,
      workflowClient,
    },
  }));

  const v1Router = new Hono<GatewayEnv>();
  v1Router.use("*", aosMiddleware({ authenticate }));
  v1Router.route("/integrations", createIntegrationsRouter({ authorizationAdapter: integrationAuthorizationAdapter, webhookEndpoint: webhookEndpointOptions }));
  const workflowServiceOptions = {
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    policyVersion: config.agentGatewayPolicyVersion,
    capabilitySecret: config.agentGatewayCapabilitySecret,
    capabilityTtlMs: config.executionCapabilityTtlMs,
    workflowRunRetentionDays: config.workflowRunRetentionDays,
    workflowClient,
  };
  v1Router.route("/investigations", createInvestigationsRouter(workflowServiceOptions));
  v1Router.route("/notifications", createNotificationsRouter());
  v1Router.route("/settings/notifications", createNotificationPreferencesRouter());
  v1Router.route("/internal/integrations", createInternalIntegrationsRouter({
    controlPlaneServiceToken: config.controlPlaneServiceToken,
    nodeEnv: config.nodeEnv,
    agentGatewayUrl: config.agentGatewayUrl,
    agentGatewayServiceToken: config.agentGatewayServiceToken,
    agentGatewayAudience: config.agentGatewayAudience,
    requestTimeoutMs: config.requestTimeoutMs,
  }));
  v1Router.route(
    "/sources",
    createSourcesRouter({
      namespace: config.temporalNamespace,
      taskQueue: config.temporalTaskQueue,
      policyVersion: config.agentGatewayPolicyVersion,
      capabilitySecret: config.agentGatewayCapabilitySecret,
      capabilityTtlMs: config.executionCapabilityTtlMs,
      workflowClient,
      artifactStore: options.sourceArtifactStore ?? createSourceArtifactStore({
        bucketName: config.sourceArtifactBucket,
        nodeEnv: config.nodeEnv,
        projectId: config.identityPlatformProjectId,
      }),
    }),
  );
  v1Router.route("/organization", createOrganizationRouter({
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    policyVersion: config.agentGatewayPolicyVersion,
    workflowClient,
  }));
  v1Router.post(
    "/context/graph/query",
    queryGraphRoute({
      client: graphClient,
      policyVersion: config.agentGatewayPolicyVersion,
      capabilitySecret: config.agentGatewayCapabilitySecret,
      capabilityTtlMs: config.executionCapabilityTtlMs,
    }),
  );
  v1Router.post(
    "/context/memory/query",
    queryMemoryRoute({
      client: memoryClient,
      policyVersion: config.agentGatewayPolicyVersion,
      capabilitySecret: config.agentGatewayCapabilitySecret,
      capabilityTtlMs: config.executionCapabilityTtlMs,
    }),
  );
  v1Router.route(
    "/context/memory",
    createMemoryChangesRouter({
      client: memoryClient,
      policyVersion: config.agentGatewayPolicyVersion,
      capabilitySecret: config.agentGatewayCapabilitySecret,
      capabilityTtlMs: config.executionCapabilityTtlMs,
    }),
  );
  v1Router.route(
    "/workflows",
    createWorkflowsRouter(
      {
        agentGatewayPolicyVersion: config.agentGatewayPolicyVersion,
        agentGatewayCapabilitySecret: config.agentGatewayCapabilitySecret,
        executionCapabilityTtlMs: config.executionCapabilityTtlMs,
        temporalNamespace: config.temporalNamespace,
        temporalTaskQueue: config.temporalTaskQueue,
        workflowRunRetentionDays: config.workflowRunRetentionDays,
      },
      workflowClient,
    ),
  );
  v1Router.route(
    "/internal/coordinator",
    createInternalCoordinatorRouter(
      {
        agentGatewayPolicyVersion: config.agentGatewayPolicyVersion,
        agentGatewayCapabilitySecret: config.agentGatewayCapabilitySecret,
        executionCapabilityTtlMs: config.executionCapabilityTtlMs,
        temporalNamespace: config.temporalNamespace,
        temporalTaskQueue: config.temporalTaskQueue,
        controlPlaneServiceToken: config.controlPlaneServiceToken,
      },
      workflowClient,
    ),
  );
  apiRouter.route(`/${ACTIVE_API_VERSION}`, v1Router);
  app.route("/api", apiRouter);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
