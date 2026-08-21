import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { getKnowledgeSource, isSourceServiceError } from "../services/source.service.js";

export const getKnowledgeSourceRoute: Handler<GatewayEnv> = async (context) => {
  const sourceId = context.req.param("sourceId");
  if (!sourceId) return context.json({ error: { code: "INVALID_REQUEST", message: "Source id is required." } }, 400);
  try {
    const data = await getKnowledgeSource(context.get("principal"), sourceId);
    return data ? context.json({ data }) : context.json({ error: { code: "SOURCE_NOT_FOUND", message: "Knowledge Source not found." } }, 404);
  } catch (error) {
    if (isSourceServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : error.code === "FORBIDDEN" ? 403 : 422);
    throw error;
  }
};
