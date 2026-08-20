import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import { listIntegrationsRoute } from "./routes/index.js";
import { updateIntegrationRoute } from "./routes/index.js";

export function createIntegrationsRouter(): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.get("/", listIntegrationsRoute);
  router.post("/:integrationId", updateIntegrationRoute);

  return router;
}
