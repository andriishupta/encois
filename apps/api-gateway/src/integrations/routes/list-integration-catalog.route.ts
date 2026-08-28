import { IntegrationType } from "@encois/contracts";
import type { Handler } from "hono";
import { parseListQuery } from "../../list-query.js";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  type IntegrationCatalogChannel,
  listIntegrationCatalogPageForPrincipal,
} from "../services/integrations.service.js";

const catalogTypes = Object.values(IntegrationType);

export const listIntegrationCatalogRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const type = context.req.query("type")?.trim().toLowerCase();
  const channel = context.req.query("channel")?.trim().toLowerCase();
  if (channel && channel !== "api" && channel !== "ai")
    return context.json(
      {
        error: {
          code: "INVALID_QUERY",
          message: "channel must be one of: api, ai.",
        },
      },
      400,
    );
  if (type && type !== "all" && !catalogTypes.includes(type as IntegrationType))
    return context.json(
      {
        error: {
          code: "INVALID_QUERY",
          message: `type must be one of: all, ${catalogTypes.join(", ")}.`,
        },
      },
      400,
    );

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
      statuses: ["active", "pending", "disabled"],
    },
  );
  if ("error" in parsed)
    return context.json(
      { error: { code: "INVALID_QUERY", message: parsed.error } },
      400,
    );

  try {
    const page = await listIntegrationCatalogPageForPrincipal(
      context.get("principal"),
      {
        query: parsed.value,
        ...(channel ? { channel: channel as IntegrationCatalogChannel } : {}),
        ...(type && type !== "all" ? { type: type as IntegrationType } : {}),
      },
    );
    return context.json({ data: page.items, pagination: page.pagination });
  } catch (error) {
    if (error instanceof Error && error.message === "DATABASE_UNAVAILABLE")
      return context.json(
        {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database is unavailable.",
          },
        },
        503,
      );
    throw error;
  }
};
