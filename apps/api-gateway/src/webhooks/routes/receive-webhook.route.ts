import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isSourceServiceError } from "../../sources/services/source.service.js";
import {
  receiveWebhook,
  type WebhookReceiverOptions,
  WebhookServiceError,
} from "../services/webhook.service.js";

export function receiveWebhookRoute(
  options: WebhookReceiverOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const data = await receiveWebhook(
        {
          organizationId: context.req.param("organizationId") ?? "",
          endpointKey: context.req.param("endpointKey") ?? "",
          eventId: context.req.header("X-Encois-Event-Id"),
          signature: context.req.header("X-Encois-Signature"),
          contentType: context.req.header("Content-Type"),
          bytes: new Uint8Array(await context.req.arrayBuffer()),
          requestId: context.get("requestId"),
          traceId: context.get("traceId"),
        },
        options,
      );
      return context.json({ data }, data.duplicate ? 200 : 202);
    } catch (error) {
      if (error instanceof WebhookServiceError) {
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
              requestId: context.get("requestId"),
              traceId: context.get("traceId"),
            },
          },
          error.status,
        );
      }
      if (isSourceServiceError(error)) {
        return context.json(
          {
            error: {
              code: error.code,
              message: error.message,
              requestId: context.get("requestId"),
              traceId: context.get("traceId"),
            },
          },
          503,
        );
      }
      throw error;
    }
  };
}
