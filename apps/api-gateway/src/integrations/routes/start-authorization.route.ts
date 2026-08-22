import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { startIntegrationAuthorizationForPrincipal } from "../services/integrations.service.js";
import type { IntegrationAuthorizationAdapter } from "../authorization-adapter.js";

export function createStartAuthorizationRoute(adapter: IntegrationAuthorizationAdapter | undefined): Handler<GatewayEnv> {
  return async (context) => {
    const integrationId = context.req.param("integrationId");
    if (!integrationId) return context.json({ error: { code: "INVALID_REQUEST", message: "Integration id is required." } }, 400);

    try {
      const data = await startIntegrationAuthorizationForPrincipal(context.get("principal"), integrationId, adapter);
      return data
        ? context.json({ data })
        : context.json({ error: { code: "INTEGRATION_NOT_FOUND", message: "Integration not found." } }, 404);
    } catch (error) {
      const code = error instanceof Error ? error.message : "INTEGRATION_AUTHORIZATION_FAILED";
      const status = code === "INTEGRATION_AUTHORIZATION_UNAVAILABLE" || code === "PERSISTENCE_UNAVAILABLE" ? 503 : code === "INVALID_AUTHORIZATION_URL" ? 502 : 502;
      return context.json({
        error: {
          code,
          message: code === "INTEGRATION_AUTHORIZATION_UNAVAILABLE"
            ? "Provider authorization is not configured for this deployment."
            : code === "PERSISTENCE_UNAVAILABLE"
              ? "Database access is not configured."
              : "The provider authorization flow could not be started.",
        },
      }, status);
    }
  };
}
