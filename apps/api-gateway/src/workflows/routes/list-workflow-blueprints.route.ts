import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError } from "../services/workflow.service.js";
import { listWorkflowBlueprintsPageForPrincipal } from "../services/workflow-creator.service.js";
import { authorizationErrorStatus } from "../utils.js";
import { parseListQuery } from "../list-query.js";

export const listWorkflowBlueprintsRoute: Handler<GatewayEnv> = async (context) => {
  const parsed = parseListQuery({
    query: context.req.query("q"),
    status: context.req.query("status"),
    sort: context.req.query("sort"),
    limit: context.req.query("limit"),
    offset: context.req.query("offset"),
  }, { maxLimit: 100, statuses: ["draft", "approved", "retired"] });
  if ("error" in parsed) return context.json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
  try {
    const page = await listWorkflowBlueprintsPageForPrincipal(context.get("principal"), parsed.value);
    return context.json({ data: page.items, pagination: page.pagination });
  } catch (error) {
    if (isWorkflowServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, authorizationErrorStatus(error.code));
    throw error;
  }
};
