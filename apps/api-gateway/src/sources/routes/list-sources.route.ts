import type { Handler } from "hono";
import { parseListQuery } from "../../list-query.js";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isSourceServiceError,
  listKnowledgeSourcesPage,
  type SourceServiceOptions,
} from "../services/source.service.js";

export function listKnowledgeSourcesRoute(
  options: SourceServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const parsed = parseListQuery(
        {
          query: context.req.query("q"),
          status: context.req.query("status"),
          sort: context.req.query("sort"),
          limit: context.req.query("limit"),
          offset: context.req.query("offset"),
        },
        {
          maxLimit: 100,
          statuses: [
            "draft",
            "connecting",
            "discovering",
            "ingesting",
            "active",
            "degraded",
            "needs_reauth",
            "failed",
            "disabled",
          ],
        },
      );
      if ("error" in parsed)
        return context.json(
          { error: { code: "INVALID_QUERY", message: parsed.error } },
          400,
        );
      const page = await listKnowledgeSourcesPage(
        context.get("principal"),
        {
          scopeUnitId: context.req.query("scopeUnitId"),
          query: parsed.value,
        },
        options,
      );
      return context.json({ data: page.items, pagination: page.pagination });
    } catch (error) {
      if (isSourceServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          error.code === "PERSISTENCE_UNAVAILABLE"
            ? 503
            : ["FORBIDDEN", "SCOPE_DENIED"].includes(error.code)
              ? 403
              : 422,
        );
      }
      throw error;
    }
  };
}
