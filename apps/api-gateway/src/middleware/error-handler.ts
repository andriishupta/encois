import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { GatewayEnv } from "./aos.js";

export const errorHandler: ErrorHandler<GatewayEnv> = (error, context) => {
  const requestId = context.get("requestId");

  if (error instanceof HTTPException) {
    return context.json(
      {
        error: {
          code: "HTTP_ERROR",
          message: error.message,
          requestId,
        },
      },
      error.status,
    );
  }

  console.error(
    JSON.stringify({
      errorClass: error instanceof Error ? error.name : "UnknownError",
      event: "http.request.failed",
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
    }),
  );

  return context.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error.",
        requestId,
      },
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler<GatewayEnv> = (context) =>
  context.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: context.get("requestId"),
      },
    },
    404,
  );
