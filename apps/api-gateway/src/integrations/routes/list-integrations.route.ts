import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { listIntegrationsForPrincipal } from "../services/integrations.service.js";

export const listIntegrationsRoute: Handler<GatewayEnv> = async (context) => {
    const principal = context.get("principal");
  try {
      const data = await listIntegrationsForPrincipal(principal, { scopeUnitId: context.req.query("scopeUnitId") });

      return context.json({ data });
    } catch (error) {
      if (error instanceof Error && error.message === "PERSISTENCE_UNAVAILABLE") {
        return context.json(
          { error: { code: "PERSISTENCE_UNAVAILABLE", message: "Database access is not configured." } },
          503,
        );
      }
      if (error instanceof Error && error.message === "SCOPE_DENIED") {
        return context.json({ error: { code: "SCOPE_DENIED", message: "The requested organization scope is not available to this user." } }, 403);
      }
      throw error;
    }
};
