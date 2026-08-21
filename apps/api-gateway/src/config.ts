export type AppConfig = {
  bodyLimitBytes: number;
  corsCredentials: boolean;
  corsOrigins: readonly string[];
  host: string;
  identityPlatformProjectId?: string;
  controlPlaneServiceToken?: string;
  controlPlaneServiceUserId?: string;
  nodeEnv: string;
  port: number;
  requestTimeoutMs: number;
  agentGatewayPolicyVersion: string;
  temporalAddress?: string;
  temporalApiKey?: string;
  temporalTlsClientCertPath?: string;
  temporalTlsClientKeyPath?: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
};

const DEFAULTS = {
  bodyLimitBytes: 1_048_576,
  host: "127.0.0.1",
  nodeEnv: "development",
  port: 8787,
  requestTimeoutMs: 10_000,
} as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    bodyLimitBytes: positiveInteger(env.BODY_LIMIT_BYTES, DEFAULTS.bodyLimitBytes),
    corsCredentials: env.CORS_CREDENTIALS === "true",
    corsOrigins,
    host: env.HOST?.trim() || DEFAULTS.host,
    identityPlatformProjectId: env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || undefined,
    controlPlaneServiceToken: env.CONTROL_PLANE_SERVICE_TOKEN?.trim() || undefined,
    controlPlaneServiceUserId: env.CONTROL_PLANE_SERVICE_USER_ID?.trim() || undefined,
    nodeEnv: env.NODE_ENV?.trim() || DEFAULTS.nodeEnv,
    port: positiveInteger(env.PORT, DEFAULTS.port),
    requestTimeoutMs: positiveInteger(env.REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    agentGatewayPolicyVersion: env.AGENT_GATEWAY_POLICY_VERSION?.trim() || "policy-read-only-fixture-v1",
    temporalAddress: env.TEMPORAL_ADDRESS?.trim() || undefined,
    temporalApiKey: env.TEMPORAL_API_KEY?.trim() || undefined,
    temporalTlsClientCertPath: env.TEMPORAL_TLS_CLIENT_CERT_PATH?.trim() || undefined,
    temporalTlsClientKeyPath: env.TEMPORAL_TLS_CLIENT_KEY_PATH?.trim() || undefined,
    temporalNamespace: env.TEMPORAL_NAMESPACE?.trim() || "default",
    temporalTaskQueue: env.TEMPORAL_TASK_QUEUE?.trim() || "encois-agent-runtime",
  };
}
