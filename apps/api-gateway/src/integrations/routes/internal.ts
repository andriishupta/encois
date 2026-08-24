import { Hono } from "hono";
import type { AppConfig } from "../../config.js";
import type { GatewayEnv } from "../../middleware/aos.js";
import { internalServiceOnly } from "../../middleware/internal-service.js";
import { createAuthorizeIntegrationRoute } from "./authorize-integration.route.js";
import { reportIntegrationHealthRoute } from "./report-health.route.js";
import { resolveIntegrationCredentialRoute } from "./resolve-credential.route.js";
import { runIntegrationHealthCheckRoute } from "./run-health-check.route.js";

export function createInternalIntegrationsRouter(
  config: Pick<
    AppConfig,
    | "controlPlaneServiceToken"
    | "nodeEnv"
    | "agentGatewayUrl"
    | "agentGatewayServiceToken"
    | "agentGatewayAudience"
    | "requestTimeoutMs"
  >,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.use("*", internalServiceOnly(config.controlPlaneServiceToken));
  router.post(
    "/:integrationId/authorization",
    createAuthorizeIntegrationRoute({
      allowLocalCredentialReferences: config.nodeEnv !== "production",
    }),
  );
  router.post("/credentials/resolve", resolveIntegrationCredentialRoute);
  router.post("/health", reportIntegrationHealthRoute);
  router.post(
    "/health-check",
    runIntegrationHealthCheckRoute({
      agentGatewayUrl: config.agentGatewayUrl,
      agentGatewayServiceToken: config.agentGatewayServiceToken,
      agentGatewayAudience: config.agentGatewayAudience,
      timeoutMs: config.requestTimeoutMs,
    }),
  );
  return router;
}
