import type { Handler } from "hono";
import { SourceIngestionTrigger } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { isSourceServiceError, startSourceIngestion, type SourceServiceOptions } from "../services/source.service.js";

function parseTrigger(value: unknown): SourceIngestionTrigger | null {
  if (value === undefined) return SourceIngestionTrigger.Manual;
  return typeof value === "string" && Object.values(SourceIngestionTrigger).includes(value as SourceIngestionTrigger)
    ? value as SourceIngestionTrigger
    : null;
}

export function startSourceIngestionRoute(options: SourceServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const sourceId = context.req.param("sourceId");
    const revisionId = context.req.param("revisionId");
    if (!sourceId || !revisionId) return context.json({ error: { code: "INVALID_REQUEST", message: "Source and revision ids are required." } }, 400);
    const body = await context.req.json().catch(() => ({}));
    const trigger = parseTrigger(typeof body === "object" && body !== null ? (body as Record<string, unknown>).trigger : undefined);
    if (!trigger) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid ingestion trigger is required." } }, 400);
    try {
      const data = await startSourceIngestion(
        context.get("principal"),
        sourceId,
        revisionId,
        trigger,
        context.get("requestId"),
        context.get("traceId"),
        options,
      );
      return data ? context.json({ data }, data.workflow.reused ? 200 : 202) : context.json({ error: { code: "SOURCE_NOT_FOUND", message: "Source or revision not found." } }, 404);
    } catch (error) {
      if (isSourceServiceError(error)) {
        const status = error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : error.code === "FORBIDDEN" || error.code === "SCOPE_DENIED" ? 403 : error.code.includes("NOT_FOUND") ? 404 : error.code.includes("CONFLICT") ? 409 : 422;
        return context.json({ error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  };
}
