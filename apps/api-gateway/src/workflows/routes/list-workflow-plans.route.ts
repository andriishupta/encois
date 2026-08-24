import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { parseListQuery } from "../list-query.js";
import {
  isWorkflowPlanServiceError,
  listWorkflowPlansPage,
} from "../services/workflow-plan.service.js";
import { workflowPlanErrorStatus } from "../utils.js";

export const listWorkflowPlansRoute: Handler<GatewayEnv> = async (context) => {
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
      statuses: ["proposed", "approved", "rejected", "applied", "expired"],
    },
  );
  if ("error" in parsed)
    return context.json(
      { error: { code: "INVALID_REQUEST", message: parsed.error } },
      400,
    );
  try {
    const page = await listWorkflowPlansPage(
      context.get("principal"),
      parsed.value,
    );
    return context.json({ data: page.items, pagination: page.pagination });
  } catch (error) {
    if (isWorkflowPlanServiceError(error)) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        workflowPlanErrorStatus(error.code),
      );
    }
    throw error;
  }
};
