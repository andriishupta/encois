import {
  type AgentMemoryRequest,
  type AgentMemoryResult,
  ContractVersion,
  isJsonObject,
} from "@encois/contracts";
import { fetchCloudRunIdentityToken } from "../security/cloud-run-identity-token.js";

export type MemoryRuntimeClient = {
  query: (request: AgentMemoryRequest) => Promise<AgentMemoryResult>;
  mutate: (request: AgentMemoryRequest) => Promise<AgentMemoryResult>;
};

export type MemoryRuntimeClientOptions = {
  baseUrl: string;
  serviceToken: string;
  audience?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export class MemoryRuntimeClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemoryRuntimeClientError";
    this.code = code;
  }
}

function isMemoryResult(value: unknown): value is AgentMemoryResult {
  if (
    !isJsonObject(value) ||
    value.contractVersion !== ContractVersion.AgentMemoryResult ||
    typeof value.requestId !== "string" ||
    typeof value.status !== "string" ||
    !["completed", "deferred", "failed"].includes(value.status)
  )
    return false;
  return (
    Array.isArray(value.memories) &&
    value.memories.every(
      (memory) =>
        isJsonObject(memory) &&
        typeof memory.id === "string" &&
        typeof memory.agentDefinition === "string" &&
        typeof memory.summary === "string" &&
        Array.isArray(memory.evidenceRefs) &&
        memory.evidenceRefs.every((ref) => typeof ref === "string") &&
        typeof memory.observedAt === "string",
    )
  );
}

export function createMemoryRuntimeClient(
  options: MemoryRuntimeClientOptions,
): MemoryRuntimeClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  async function execute(
    path: string,
    request: AgentMemoryRequest,
    rejectedMessage: string,
  ): Promise<AgentMemoryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const identityToken = options.audience
        ? await fetchCloudRunIdentityToken(options.audience, fetchImpl)
        : undefined;
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Encois-Service-Token": options.serviceToken,
          ...(identityToken
            ? { Authorization: `Bearer ${identityToken}` }
            : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          isJsonObject(body) &&
          isJsonObject(body.error) &&
          typeof body.error.message === "string"
            ? body.error.message
            : rejectedMessage;
        throw new MemoryRuntimeClientError("MEMORY_RUNTIME_ERROR", message);
      }
      if (!isMemoryResult(body))
        throw new MemoryRuntimeClientError(
          "INVALID_MEMORY_RESPONSE",
          "The memory service returned an invalid response.",
        );
      return body;
    } catch (error) {
      if (error instanceof MemoryRuntimeClientError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new MemoryRuntimeClientError(
          "MEMORY_RUNTIME_TIMEOUT",
          "The memory service did not respond in time.",
        );
      throw new MemoryRuntimeClientError(
        "MEMORY_RUNTIME_UNAVAILABLE",
        "The memory service could not be reached.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    query: (request) =>
      execute(
        "/v1/memory/query",
        request,
        "The memory service rejected the query.",
      ),
    mutate: (request) =>
      execute(
        "/v1/memory/mutate",
        request,
        "The memory service rejected the mutation.",
      ),
  };
}
