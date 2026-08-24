import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isWorkflowServiceError, listWorkflowsPage, type WorkflowServiceOptions } from "../services/workflow.service.js";
import { authorizationErrorStatus } from "../utils.js";
import { parseListQuery } from "../list-query.js";

export function listWorkflowsRoute(options: WorkflowServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const parsed = parseListQuery({
      query: context.req.query("q"),
      status: context.req.query("status"),
      sort: context.req.query("sort"),
      limit: context.req.query("limit"),
      offset: context.req.query("offset"),
    }, { maxLimit: 100, statuses: ["queued", "running", "waiting", "paused", "completed", "failed", "partial", "cancelled"] });
    if ("error" in parsed) return context.json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
    try {
      const page = await listWorkflowsPage(context.get("principal"), options, parsed.value);
      return context.json({ data: page.items, pagination: page.pagination });
    } catch (error) {
      if (isWorkflowServiceError(error)) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          authorizationErrorStatus(error.code),
        );
      }
      throw error;
    }
  };
}
