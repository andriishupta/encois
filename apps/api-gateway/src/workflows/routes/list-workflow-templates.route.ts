import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowTemplateServiceError,
  listWorkflowTemplatesPageForPrincipal,
} from "../services/workflow-template.service.js";
import { parseListQuery } from "../list-query.js";

export const listWorkflowTemplatesRoute: Handler<GatewayEnv> = async (context) => {
  const parsed = parseListQuery({
    query: context.req.query("q") ?? context.req.query("keywords"),
    status: context.req.query("status"),
    sort: context.req.query("sort"),
    limit: context.req.query("limit"),
    offset: context.req.query("offset"),
  }, { maxLimit: 50, statuses: ["active", "disabled"] });
  if ("error" in parsed) return context.json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);

  const input = {
    query: parsed.value.query,
    category: context.req.query("category"),
    status: parsed.value.status,
    sort: parsed.value.sort,
    limit: parsed.value.limit,
    offset: parsed.value.offset,
  };

  try {
    const page = await listWorkflowTemplatesPageForPrincipal(context.get("principal"), input);
    return context.json({ data: page.items, pagination: page.pagination });
  } catch (error) {
    if (isWorkflowTemplateServiceError(error)) {
      return context.json(
        { error: { code: "PERSISTENCE_UNAVAILABLE", message: "Database access is not configured." } },
        503,
      );
    }
    throw error;
  }
};
