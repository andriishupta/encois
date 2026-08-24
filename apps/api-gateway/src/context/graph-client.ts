import {
  ContractVersion,
  type GraphQueryRequest,
  type GraphQueryResult,
  isJsonObject,
} from "@encois/contracts";
import { fetchCloudRunIdentityToken } from "../security/cloud-run-identity-token.js";

export type GraphGatewayClient = {
  query: (request: GraphQueryRequest) => Promise<GraphQueryResult>;
};

export type GraphGatewayClientOptions = {
  baseUrl: string;
  serviceToken: string;
  audience?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export class GraphGatewayClientError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "GraphGatewayClientError";
    this.code = code;
    this.status = status;
  }
}

function isGraphQueryResult(value: unknown): value is GraphQueryResult {
  if (
    !isJsonObject(value) ||
    value.contractVersion !== ContractVersion.GraphQueryResult ||
    typeof value.requestId !== "string" ||
    typeof value.status !== "string" ||
    !["completed", "deferred", "failed"].includes(value.status)
  )
    return false;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
  if (
    !value.nodes.every(
      (node) =>
        isJsonObject(node) &&
        typeof node.id === "string" &&
        typeof node.type === "string" &&
        isJsonObject(node.properties),
    )
  )
    return false;
  if (
    !value.edges.every(
      (edge) =>
        isJsonObject(edge) &&
        typeof edge.id === "string" &&
        typeof edge.sourceId === "string" &&
        typeof edge.targetId === "string" &&
        typeof edge.relationship === "string" &&
        isJsonObject(edge.properties),
    )
  )
    return false;
  return (
    value.evidenceRefs === undefined ||
    (Array.isArray(value.evidenceRefs) &&
      value.evidenceRefs.every((ref) => typeof ref === "string"))
  );
}

function responseError(value: unknown): { code?: string; message?: string } {
  if (!isJsonObject(value) || !isJsonObject(value.error)) return {};
  return {
    ...(typeof value.error.code === "string" ? { code: value.error.code } : {}),
    ...(typeof value.error.message === "string"
      ? { message: value.error.message }
      : {}),
  };
}

export function createGraphGatewayClient(
  options: GraphGatewayClientOptions,
): GraphGatewayClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async query(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const identityToken = options.audience
          ? await fetchCloudRunIdentityToken(options.audience, fetchImpl)
          : undefined;
        const response = await fetchImpl(`${baseUrl}/v1/graph/query`, {
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
          const error = responseError(body);
          throw new GraphGatewayClientError(
            error.code ?? "GRAPH_GATEWAY_ERROR",
            error.message ?? "The graph service rejected the query.",
            response.status,
          );
        }
        if (!isGraphQueryResult(body))
          throw new GraphGatewayClientError(
            "INVALID_GRAPH_RESPONSE",
            "The graph service returned an invalid response.",
            response.status,
          );
        return body;
      } catch (error) {
        if (error instanceof GraphGatewayClientError) throw error;
        if (error instanceof Error && error.name === "AbortError")
          throw new GraphGatewayClientError(
            "GRAPH_GATEWAY_TIMEOUT",
            "The graph service did not respond in time.",
          );
        throw new GraphGatewayClientError(
          "GRAPH_GATEWAY_UNAVAILABLE",
          "The graph service could not be reached.",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
