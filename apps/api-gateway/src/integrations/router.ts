import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import type { IntegrationAuthorizationAdapter } from "./authorization-adapter.js";
import {
  createIntegrationRoute,
  getWebhookEndpointRoute,
  listIntegrationsRoute,
  provisionWebhookEndpointRoute,
  rotateWebhookEndpointRoute,
  setWebhookEndpointStatusRoute,
  updateIntegrationRoute,
} from "./routes/index.js";
import { createStartAuthorizationRoute } from "./routes/start-authorization.route.js";
import type { WebhookEndpointServiceOptions } from "./services/webhook-endpoint.service.js";

export function createIntegrationsRouter(
  options: {
    authorizationAdapter?: IntegrationAuthorizationAdapter;
    webhookEndpoint?: WebhookEndpointServiceOptions;
  } = {},
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.get("/", listIntegrationsRoute);
  router.post("/", createIntegrationRoute);
  router.post("/:integrationId", updateIntegrationRoute);
  router.post(
    "/:integrationId/authorization/start",
    createStartAuthorizationRoute(options.authorizationAdapter),
  );
  if (options.webhookEndpoint) {
    router.get(
      "/:integrationId/webhook",
      getWebhookEndpointRoute(options.webhookEndpoint),
    );
    router.post(
      "/:integrationId/webhook",
      provisionWebhookEndpointRoute(options.webhookEndpoint),
    );
    router.post(
      "/:integrationId/webhook/rotate",
      rotateWebhookEndpointRoute(options.webhookEndpoint),
    );
    router.post(
      "/:integrationId/webhook/enable",
      setWebhookEndpointStatusRoute(options.webhookEndpoint, "active"),
    );
    router.post(
      "/:integrationId/webhook/disable",
      setWebhookEndpointStatusRoute(options.webhookEndpoint, "disabled"),
    );
  }

  return router;
}
