import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isSourceServiceError, listKnowledgeSources } from "../services/source.service.js";

export const listKnowledgeSourcesRoute: Handler<GatewayEnv> = async (context) => {
  try {
    return context.json({ data: await listKnowledgeSources(context.get("principal")) });
  } catch (error) {
    if (isSourceServiceError(error)) {
      return context.json({ error: { code: error.code, message: error.message } }, error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : error.code === "FORBIDDEN" ? 403 : 422);
    }
    throw error;
  }
};
