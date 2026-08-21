import { createHmac } from "node:crypto";
import type { ExecutionScope } from "@encois/contracts";

export const EXECUTION_CAPABILITY_VERSION = "execution-capability.v1" as const;
export const EXECUTION_CAPABILITY_AUDIENCE = "agent-gateway" as const;
export const DEFAULT_EXECUTION_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;

type CapabilityClaims = {
  v: typeof EXECUTION_CAPABILITY_VERSION;
  aud: typeof EXECUTION_CAPABILITY_AUDIENCE;
  organizationId: string;
  workflowId: string;
  actorId: string;
  policyVersion: string;
  scopeIds: readonly string[];
  issuedAt: number;
  expiresAt: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

/**
 * Issues an internal capability bound to one workflow and exact organization
 * unit scope. It is never accepted from a browser request; the Gateway
 * creates it only after authenticating and resolving the caller's scope.
 */
export function createExecutionCapability(input: {
  secret: string;
  organizationId: string;
  workflowId: string;
  actorId: string;
  policyVersion: string;
  scope: ExecutionScope;
  now?: Date;
  ttlMs?: number;
}): string {
  if (!input.secret) throw new Error("execution capability secret is not configured");
  if (!input.organizationId || !input.workflowId || !input.actorId || !input.policyVersion || input.scope.ids.length === 0) {
    throw new Error("execution capability claims are incomplete");
  }
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const ttlMs = input.ttlMs ?? DEFAULT_EXECUTION_CAPABILITY_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error("execution capability TTL must be positive");
  const claims: CapabilityClaims = {
    v: EXECUTION_CAPABILITY_VERSION,
    aud: EXECUTION_CAPABILITY_AUDIENCE,
    organizationId: input.organizationId,
    workflowId: input.workflowId,
    actorId: input.actorId,
    policyVersion: input.policyVersion,
    scopeIds: [...new Set(input.scope.ids)].sort(),
    issuedAt,
    expiresAt: issuedAt + Math.ceil(ttlMs / 1000),
  };
  const header = encode(JSON.stringify({ alg: "HS256", typ: EXECUTION_CAPABILITY_VERSION }));
  const payload = encode(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(signingInput, input.secret)}`;
}
