import {
  isJsonObject,
  type MemoryChangeAction,
  type MemoryChangeRequest,
} from "@encois/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import { GraphServiceError } from "./graph.service.js";
import {
  applyMemoryChange,
  approveMemoryChange,
  createMemoryChange,
  listMemoryChanges,
  type MemoryChangeServiceOptions,
  rejectMemoryChange,
} from "./memory-change.service.js";

function parseRequest(value: unknown): MemoryChangeRequest | null {
  if (
    !isJsonObject(value) ||
    typeof value.agentDefinition !== "string" ||
    typeof value.action !== "string"
  )
    return null;
  if (value.memoryId !== undefined && typeof value.memoryId !== "string")
    return null;
  if (value.projectId !== undefined && typeof value.projectId !== "string")
    return null;
  if (value.userId !== undefined && typeof value.userId !== "string")
    return null;
  if (
    value.replacementSummary !== undefined &&
    typeof value.replacementSummary !== "string"
  )
    return null;
  if (
    value.evidenceRefs !== undefined &&
    (!Array.isArray(value.evidenceRefs) ||
      value.evidenceRefs.some((ref) => typeof ref !== "string"))
  )
    return null;
  if (
    !isJsonObject(value.scope) ||
    !Array.isArray(value.scope.ids) ||
    value.scope.ids.some((id) => typeof id !== "string")
  )
    return null;
  if (
    value.action !== "add" &&
    value.action !== "correct" &&
    value.action !== "delete"
  )
    return null;
  return {
    ...(value.memoryId ? { memoryId: value.memoryId } : {}),
    agentDefinition: value.agentDefinition,
    ...(value.projectId ? { projectId: value.projectId } : {}),
    ...(value.userId ? { userId: value.userId } : {}),
    scope: { ids: value.scope.ids as string[] },
    action: value.action as MemoryChangeAction,
    ...(value.replacementSummary
      ? { replacementSummary: value.replacementSummary }
      : {}),
    ...(Array.isArray(value.evidenceRefs)
      ? { evidenceRefs: value.evidenceRefs as string[] }
      : {}),
  };
}

function statusFor(code: string): 400 | 403 | 404 | 502 | 503 | 409 {
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "MEMORY_CHANGE_NOT_FOUND") return 404;
  if (
    code.endsWith("CONFLICT") ||
    code.endsWith("NOT_DECIDABLE") ||
    code.endsWith("NOT_APPLICABLE")
  )
    return 409;
  if (code === "MEMORY_RUNTIME_ERROR" || code === "MEMORY_TIMEOUT") return 502;
  if (
    code === "DATABASE_UNAVAILABLE" ||
    code === "MEMORY_UNAVAILABLE" ||
    code === "CAPABILITY_NOT_CONFIGURED"
  )
    return 503;
  return 400;
}

function handleError(context: Context<GatewayEnv>, error: unknown) {
  if (!(error instanceof GraphServiceError)) throw error;
  return context.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId: context.get("requestId"),
        traceId: context.get("traceId"),
      },
    },
    statusFor(error.code),
  );
}

export function createMemoryChangesRouter(
  options: MemoryChangeServiceOptions,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.get("/changes", async (context) => {
    const rawLimit = context.req.query("limit");
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "limit must be an integer between 1 and 100.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await listMemoryChanges(context.get("principal"), limit),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });
  router.post("/changes", async (context) => {
    const request = parseRequest(await context.req.json().catch(() => null));
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message:
              "A valid agent definition, scope, and supported memory action are required.",
          },
        },
        400,
      );
    try {
      return context.json(
        { data: await createMemoryChange(context.get("principal"), request) },
        201,
      );
    } catch (error) {
      return handleError(context, error);
    }
  });
  router.post("/changes/:changeId/approve", async (context) => {
    const id = context.req.param("changeId")?.trim();
    if (!id)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Memory change id is required.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await approveMemoryChange(context.get("principal"), id),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });
  router.post("/changes/:changeId/reject", async (context) => {
    const id = context.req.param("changeId")?.trim();
    if (!id)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Memory change id is required.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await rejectMemoryChange(context.get("principal"), id),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });
  router.post("/changes/:changeId/apply", async (context) => {
    const id = context.req.param("changeId")?.trim();
    if (!id)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Memory change id is required.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await applyMemoryChange(
          context.get("principal"),
          id,
          context.get("requestId"),
          context.get("traceId"),
          options,
        ),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });
  return router;
}
