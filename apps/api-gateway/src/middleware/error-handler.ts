import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { GatewayEnv } from "./aos.js";

function internalErrorCategory(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error))
    return "server_dependency";
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return "database_constraint";
  if (typeof code === "string" && code.startsWith("08"))
    return "database_connection";
  return "server_dependency";
}

export const errorHandler: ErrorHandler<GatewayEnv> = (error, context) => {
  const requestId = context.get("requestId");
  const traceId = context.get("traceId");

  if (error instanceof HTTPException) {
    return context.json(
      {
        data: null,
        error: {
          code: "HTTP_ERROR",
          message: error.message,
          requestId,
          traceId,
        },
      },
      error.status,
    );
  }

  console.error(
    JSON.stringify({
      category: internalErrorCategory(error),
      errorClass: error instanceof Error ? error.name : "UnknownError",
      event: "http.request.failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
      traceId,
    }),
  );

  return context.json(
    {
      data: null,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: `The server could not complete this request. Check the server logs using request ID ${requestId}.`,
        requestId,
        traceId,
      },
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler<GatewayEnv> = (context) =>
  context.json(
    {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: context.get("requestId"),
        traceId: context.get("traceId"),
      },
    },
    404,
  );
