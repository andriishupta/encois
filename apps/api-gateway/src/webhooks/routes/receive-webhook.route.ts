import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";

export const receiveWebhookRoute: Handler<GatewayEnv> = (context) =>
  context.json(
    {
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Webhook handling is not implemented.",
        requestId: context.get("requestId"),
      },
    },
    501,
  );
