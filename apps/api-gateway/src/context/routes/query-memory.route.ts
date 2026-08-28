import {
  isJsonObject,
  type MemoryInspectionQueryRequest,
} from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { GraphServiceError } from "../graph.service.js";
import {
  type MemoryServiceOptions,
  queryMemoryForPrincipal,
} from "../memory.service.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function parseRequest(value: unknown): MemoryInspectionQueryRequest | null {
  if (!isJsonObject(value)) return null;
  const agentDefinition =
    value.agentDefinition === undefined
      ? undefined
      : readString(value.agentDefinition);
  const query = value.query === undefined ? undefined : readString(value.query);
  const projectId =
    value.projectId === undefined ? undefined : readString(value.projectId);
  const maxResults =
    value.maxResults === undefined ? undefined : readInteger(value.maxResults);
  if (value.agentDefinition !== undefined && agentDefinition === undefined)
    return null;
  if (value.projectId !== undefined && projectId === undefined) return null;
  if (value.query !== undefined && query === undefined) return null;
  if (value.maxResults !== undefined && maxResults === undefined) return null;
  if (
    value.scope !== undefined &&
    (!isJsonObject(value.scope) ||
      !Array.isArray(value.scope.ids) ||
      value.scope.ids.some((id) => typeof id !== "string"))
  )
    return null;
  return {
    ...(agentDefinition === undefined ? {} : { agentDefinition }),
    ...(query === undefined ? {} : { query }),
    ...(projectId ? { projectId } : {}),
    ...(maxResults === undefined ? {} : { maxResults }),
    ...(value.scope ? { scope: { ids: value.scope.ids as string[] } } : {}),
  };
}

function statusFor(code: string): 400 | 403 | 502 | 503 {
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "MEMORY_RUNTIME_ERROR" || code === "MEMORY_TIMEOUT") return 502;
  if (
    code === "DATABASE_UNAVAILABLE" ||
    code === "MEMORY_UNAVAILABLE" ||
    code === "CAPABILITY_NOT_CONFIGURED"
  )
    return 503;
  return 400;
}

export function queryMemoryRoute(
  options: MemoryServiceOptions,
): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseRequest(await context.req.json().catch(() => null));
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Memory query payload is invalid.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await queryMemoryForPrincipal(
          context.get("principal"),
          request,
          context.get("requestId"),
          context.get("traceId"),
          options,
        ),
      });
    } catch (error) {
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
  };
}
