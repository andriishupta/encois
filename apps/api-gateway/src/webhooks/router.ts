import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { GatewayEnv } from "../middleware/aos.js";
import { receiveWebhookRoute } from "./routes/index.js";
import type { WebhookReceiverOptions } from "./services/webhook.service.js";

export function createWebhooksRouter(
  options: WebhookReceiverOptions,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.use(
    "/:organizationId/:endpointKey",
    bodyLimit({ maxSize: 1 * 1024 * 1024 }),
  );
  router.post("/:organizationId/:endpointKey", receiveWebhookRoute(options));
  return router;
}
