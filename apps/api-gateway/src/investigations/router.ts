import { isJsonObject } from "@encois/contracts";
import { Hono } from "hono";
import { parseListQuery } from "../list-query.js";
import type { GatewayEnv } from "../middleware/aos.js";
import type { WorkflowServiceOptions } from "../workflows/services/workflow.service.js";
import {
  createSavedInvestigation,
  deleteSavedInvestigation,
  getSavedInvestigation,
  isInvestigationServiceError,
  listSavedInvestigationsPage,
} from "./investigations.service.js";
import {
  getNotificationPreferences,
  isNotificationServiceError,
  listNotificationsPage,
  markNotificationRead,
  updateNotificationPreferences,
} from "./notifications.service.js";
import {
  isRecommendationServiceError,
  listRecommendations,
  updateRecommendation,
} from "./recommendations.service.js";

function statusFor(code: string): 400 | 403 | 404 | 409 | 503 {
  if (code === "FORBIDDEN" || code === "IDENTITY_NOT_RESOLVED") return 403;
  if (code === "PERSISTENCE_UNAVAILABLE") return 503;
  if (
    code === "INVESTIGATION_NOT_FOUND" ||
    code === "NOTIFICATION_NOT_FOUND" ||
    code === "RECOMMENDATION_NOT_FOUND"
  )
    return 404;
  if (code === "DUPLICATE_INVESTIGATION") return 409;
  return 400;
}

export function createInvestigationsRouter(
  options: Pick<
    WorkflowServiceOptions,
    | "workflowClient"
    | "namespace"
    | "policyVersion"
    | "taskQueue"
    | "capabilitySecret"
    | "capabilityTtlMs"
    | "workflowRunRetentionDays"
  >,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.get("/", async (context) => {
    const parsed = parseListQuery(
      {
        query: context.req.query("q"),
        sort: context.req.query("sort"),
        limit: context.req.query("limit"),
        offset: context.req.query("offset"),
      },
      { maxLimit: 100 },
    );
    if ("error" in parsed)
      return context.json(
        { error: { code: "INVALID_QUERY", message: parsed.error } },
        400,
      );
    try {
      const page = await listSavedInvestigationsPage(
        context.get("principal"),
        parsed.value,
      );
      return context.json({
        data: page.items,
        pagination: page.pagination,
      });
    } catch (cause) {
      if (isInvestigationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.get("/:investigationId", async (context) => {
    try {
      return context.json({
        data: await getSavedInvestigation(
          context.get("principal"),
          context.req.param("investigationId") ?? "",
        ),
      });
    } catch (cause) {
      if (isInvestigationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.post("/", async (context) => {
    const body = await context.req.json().catch(() => null);
    if (
      !isJsonObject(body) ||
      typeof body.name !== "string" ||
      typeof body.kind !== "string" ||
      typeof body.query !== "string" ||
      !isJsonObject(body.scope) ||
      !Array.isArray(body.scope.ids) ||
      (body.params !== undefined && !isJsonObject(body.params))
    )
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message:
              "name, kind, query, scope, and object params are required.",
          },
        },
        400,
      );
    try {
      return context.json(
        {
          data: await createSavedInvestigation(context.get("principal"), {
            name: body.name,
            kind: body.kind as "graph" | "memory" | "workflow",
            query: body.query,
            ...(isJsonObject(body.params) ? { params: body.params } : {}),
            scope: { ids: body.scope.ids as string[] },
          }),
        },
        201,
      );
    } catch (cause) {
      if (isInvestigationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.delete("/:investigationId", async (context) => {
    try {
      const deleted = await deleteSavedInvestigation(
        context.get("principal"),
        context.req.param("investigationId") ?? "",
      );
      if (!deleted)
        return context.json(
          {
            error: {
              code: "INVESTIGATION_NOT_FOUND",
              message: "Saved investigation not found.",
            },
          },
          404,
        );
      return context.json({ data: { deleted: true } });
    } catch (cause) {
      if (isInvestigationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.get("/recommendations", async (context) => {
    try {
      return context.json({
        data: await listRecommendations(context.get("principal"), options),
      });
    } catch (cause) {
      if (isRecommendationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.post("/recommendations/:recommendationId/:action", async (context) => {
    const action = context.req.param("action");
    if (action !== "accept" && action !== "dismiss")
      return context.json(
        {
          error: {
            code: "INVALID_RECOMMENDATION_ACTION",
            message: "Recommendation action must be accept or dismiss.",
          },
        },
        400,
      );
    try {
      const recommendation = await updateRecommendation(
        context.get("principal"),
        context.req.param("recommendationId") ?? "",
        action,
      );
      if (!recommendation)
        return context.json(
          {
            error: {
              code: "RECOMMENDATION_NOT_FOUND",
              message:
                "Recommendation not found in the current organization scope.",
            },
          },
          404,
        );
      return context.json({ data: recommendation });
    } catch (cause) {
      if (isRecommendationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  return router;
}

export function createNotificationsRouter(): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.get("/", async (context) => {
    const parsed = parseListQuery(
      {
        query: context.req.query("q"),
        status: context.req.query("status"),
        sort: context.req.query("sort"),
        limit: context.req.query("limit"),
        offset: context.req.query("offset"),
      },
      { maxLimit: 100, statuses: ["read", "unread"] },
    );
    if ("error" in parsed)
      return context.json(
        { error: { code: "INVALID_QUERY", message: parsed.error } },
        400,
      );
    try {
      const page = await listNotificationsPage(
        context.get("principal"),
        parsed.value,
      );
      return context.json({
        data: page.items,
        pagination: page.pagination,
      });
    } catch (cause) {
      if (isNotificationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.post("/:notificationId/read", async (context) => {
    try {
      const updated = await markNotificationRead(
        context.get("principal"),
        context.req.param("notificationId") ?? "",
      );
      if (!updated)
        return context.json(
          {
            error: {
              code: "NOTIFICATION_NOT_FOUND",
              message: "Notification not found.",
            },
          },
          404,
        );
      return context.json({ data: { read: true } });
    } catch (cause) {
      if (isNotificationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  return router;
}

export function createNotificationPreferencesRouter(): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.get("/", async (context) => {
    try {
      return context.json({
        data: await getNotificationPreferences(context.get("principal")),
      });
    } catch (cause) {
      if (isNotificationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  router.put("/", async (context) => {
    const body = await context.req.json().catch(() => null);
    if (
      !isJsonObject(body) ||
      ![
        "emailEnabled",
        "pushEnabled",
        "workflowUpdates",
        "evidenceReady",
        "weeklyDigest",
      ].every((key) => typeof body[key] === "boolean")
    )
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "All notification preference values must be boolean.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await updateNotificationPreferences(context.get("principal"), {
          emailEnabled: body.emailEnabled as boolean,
          pushEnabled: body.pushEnabled as boolean,
          workflowUpdates: body.workflowUpdates as boolean,
          evidenceReady: body.evidenceReady as boolean,
          weeklyDigest: body.weeklyDigest as boolean,
        }),
      });
    } catch (cause) {
      if (isNotificationServiceError(cause))
        return context.json(
          { error: { code: cause.code, message: cause.message } },
          statusFor(cause.code),
        );
      throw cause;
    }
  });
  return router;
}
