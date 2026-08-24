import type { Handler } from "hono";
import { parseListQuery } from "../../list-query.js";
import type { GatewayEnv } from "../../middleware/aos.js";
import { listIntegrationsPageForPrincipal } from "../services/integrations.service.js";

export const listIntegrationsRoute: Handler<GatewayEnv> = async (context) => {
  const principal = context.get("principal");
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
          "pending",
          "authorized",
          "active",
          "degraded",
          "needs_reauth",
          "error",
          "disabled",
        ],
      },
    );
    if ("error" in parsed)
      return context.json(
        { error: { code: "INVALID_QUERY", message: parsed.error } },
        400,
      );
    const page = await listIntegrationsPageForPrincipal(principal, {
      scopeUnitId: context.req.query("scopeUnitId"),
      query: parsed.value,
    });
    return context.json({ data: page.items, pagination: page.pagination });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSISTENCE_UNAVAILABLE") {
      return context.json(
        {
          error: {
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Database access is not configured.",
          },
        },
        503,
      );
    }
    if (error instanceof Error && error.message === "SCOPE_DENIED") {
      return context.json(
        {
          error: {
            code: "SCOPE_DENIED",
            message:
              "The requested organization scope is not available to this user.",
          },
        },
        403,
      );
    }
    throw error;
  }
};
