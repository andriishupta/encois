import type { Handler } from "hono";
import { isJsonObject, type JsonObject, type SourceRevisionCreateRequest } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { createSourceRevision, isSourceServiceError } from "../services/source.service.js";

function optionalString(value: Record<string, unknown>, key: string): string | undefined | null {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}

function parseRequest(value: unknown): SourceRevisionCreateRequest | null {
  if (!isJsonObject(value)) return null;
  const revision = optionalString(value, "revision");
  const artifactRef = optionalString(value, "artifactRef");
  const sourceObjectId = optionalString(value, "sourceObjectId");
  const contentType = optionalString(value, "contentType");
  const checksum = optionalString(value, "checksum");
  const observedAt = optionalString(value, "observedAt");
  const metadata = value.metadata;
  if (!revision || artifactRef === null || sourceObjectId === null || contentType === null || checksum === null || observedAt === null) return null;
  if (observedAt && Number.isNaN(Date.parse(observedAt))) return null;
  if (metadata !== undefined && (!isJsonObject(metadata) || Array.isArray(metadata))) return null;
  return {
    revision,
    ...(artifactRef ? { artifactRef } : {}),
    ...(sourceObjectId ? { sourceObjectId } : {}),
    ...(contentType ? { contentType } : {}),
    ...(checksum ? { checksum } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(metadata ? { metadata: metadata as JsonObject } : {}),
  };
}

export const createSourceRevisionRoute: Handler<GatewayEnv> = async (context) => {
  const sourceId = context.req.param("sourceId");
  if (!sourceId) return context.json({ error: { code: "INVALID_REQUEST", message: "Source id is required." } }, 400);
  const request = parseRequest(await context.req.json().catch(() => null));
  if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid source revision payload is required." } }, 400);
  try {
    const revision = await createSourceRevision(context.get("principal"), sourceId, request);
    return revision ? context.json({ data: revision }, 201) : context.json({ error: { code: "SOURCE_NOT_FOUND", message: "Source not found." } }, 404);
  } catch (error) {
    if (isSourceServiceError(error)) {
      const status = error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : error.code === "FORBIDDEN" ? 403 : error.code.includes("CONFLICT") ? 409 : 422;
      return context.json({ error: { code: error.code, message: error.message } }, status);
    }
    throw error;
  }
};
