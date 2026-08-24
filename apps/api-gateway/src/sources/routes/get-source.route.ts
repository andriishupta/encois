import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { getKnowledgeSource, isSourceServiceError, type SourceServiceOptions } from "../services/source.service.js";

export function getKnowledgeSourceRoute(options: SourceServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
  const sourceId = context.req.param("sourceId");
  if (!sourceId) return context.json({ error: { code: "INVALID_REQUEST", message: "Source id is required." } }, 400);
  try {
    const data = await getKnowledgeSource(context.get("principal"), sourceId, options);
    return data ? context.json({ data }) : context.json({ error: { code: "SOURCE_NOT_FOUND", message: "Source not found." } }, 404);
  } catch (error) {
    if (isSourceServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : error.code === "FORBIDDEN" ? 403 : 422);
    throw error;
  }
  };
}
