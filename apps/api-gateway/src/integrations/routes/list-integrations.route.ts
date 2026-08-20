import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { IntegrationsService } from "../services/integrations.service.js";

export function listIntegrationsRoute(integrationsService: IntegrationsService): Handler<GatewayEnv> {
  return async (context) => {
    const principal = context.get("principal");
    try {
      const data = await integrationsService.listForPrincipal(principal);

      return context.json({ data });
    } catch (error) {
      if (error instanceof Error && error.message === "PERSISTENCE_UNAVAILABLE") {
        return context.json(
          { error: { code: "PERSISTENCE_UNAVAILABLE", message: "Database access is not configured." } },
          503,
        );
      }
      throw error;
    }
  };
}
