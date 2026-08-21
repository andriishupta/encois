import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  isWorkflowTemplateServiceError,
  listWorkflowTemplatesForPrincipal,
  type WorkflowTemplateQuery,
} from "../services/workflow-template.service.js";

function parseLimit(value: string | undefined): number | "invalid" | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const limit = Number(value);
  return Number.isInteger(limit) ? limit : "invalid";
}

export const listWorkflowTemplatesRoute: Handler<GatewayEnv> = async (context) => {
  const requestedLimit = parseLimit(context.req.query("limit"));
  if (requestedLimit === "invalid" || (requestedLimit !== undefined && (requestedLimit < 1 || requestedLimit > 10))) {
    return context.json(
      { error: { code: "INVALID_REQUEST", message: "limit must be an integer between 1 and 10." } },
      400,
    );
  }

  const input: WorkflowTemplateQuery = {
    query: context.req.query("q") ?? context.req.query("keywords"),
    category: context.req.query("category"),
    limit: requestedLimit,
  };

  try {
    return context.json({ data: await listWorkflowTemplatesForPrincipal(context.get("principal"), input) });
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
