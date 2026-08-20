import { Hono } from "hono";
import type { PersistenceDatabase } from "@encois/persistence";
import type { GatewayEnv } from "../middleware/aos.js";
import { listIntegrationsRoute } from "./routes/index.js";
import { updateIntegrationRoute } from "./routes/index.js";
import { IntegrationsService } from "./services/integrations.service.js";

export function createIntegrationsRouter(database?: PersistenceDatabase): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  const integrationsService = new IntegrationsService(database);

  router.get("/", listIntegrationsRoute(integrationsService));
  router.post("/:integrationId", updateIntegrationRoute(integrationsService));

  return router;
}
