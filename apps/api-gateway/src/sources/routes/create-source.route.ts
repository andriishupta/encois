import type { Handler } from "hono";
import {
  KnowledgeSourceKind,
  type KnowledgeSourceCreateRequest,
  type JsonObject,
} from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  createKnowledgeSource,
  isSourceServiceError,
  parseSourceScope,
} from "../services/source.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined | null {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}

function parseRequest(value: unknown): KnowledgeSourceCreateRequest | null {
  if (!isRecord(value)) return null;
  const name = optionalString(value, "name");
  const kind = value.kind;
  const provider = optionalString(value, "provider");
  const integrationId = optionalString(value, "integrationId");
  const contentType = optionalString(value, "contentType");
  const readScope = parseSourceScope(value.readScope);
  const visibilityScope = parseSourceScope(value.visibilityScope);
  if (
    !name ||
    typeof kind !== "string" ||
    !Object.values(KnowledgeSourceKind).includes(kind as KnowledgeSourceKind) ||
    provider === null ||
    integrationId === null ||
    contentType === null ||
    !readScope ||
    !visibilityScope
  ) return null;
  if (value.configuration !== undefined && (!isRecord(value.configuration) || Array.isArray(value.configuration))) return null;
  return {
    name,
    kind: kind as KnowledgeSourceKind,
    ...(provider ? { provider } : {}),
    ...(integrationId ? { integrationId } : {}),
    readScope,
    visibilityScope,
    ...(contentType ? { contentType } : {}),
    ...(value.configuration ? { configuration: value.configuration as JsonObject } : {}),
  };
}

function statusForSourceError(code: string): 400 | 403 | 404 | 409 | 422 | 500 | 503 {
  if (code === "PERSISTENCE_UNAVAILABLE") return 503;
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "SOURCE_CREATE_FAILED") return 500;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("MISMATCH") || code.includes("CONFLICT")) return 409;
  return 422;
}

export const createKnowledgeSourceRoute: Handler<GatewayEnv> = async (context) => {
  const request = parseRequest(await context.req.json().catch(() => null));
  if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid Knowledge Source payload is required." } }, 400);
  try {
    return context.json({ data: await createKnowledgeSource(context.get("principal"), request) }, 201);
  } catch (error) {
    if (isSourceServiceError(error)) return context.json({ error: { code: error.code, message: error.message } }, statusForSourceError(error.code));
    throw error;
  }
};
