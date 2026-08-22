export type AppConfig = {
  bodyLimitBytes: number;
  corsCredentials: boolean;
  corsOrigins: readonly string[];
  host: string;
  identityPlatformProjectId?: string;
  sourceArtifactBucket?: string;
  identityPlatformAllowedSignInProviders?: readonly string[];
  controlPlaneServiceToken?: string;
  controlPlaneServiceUserId?: string;
  nodeEnv: string;
  port: number;
  requestTimeoutMs: number;
  agentGatewayPolicyVersion: string;
  agentGatewayCapabilitySecret?: string;
  executionCapabilityTtlMs: number;
  workflowMode: "memory" | "database" | "temporal";
  temporalAddress?: string;
  temporalApiKey?: string;
  temporalTlsClientCertPath?: string;
  temporalTlsClientKeyPath?: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
};

const DEFAULTS = {
  bodyLimitBytes: 12_582_912,
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
  const nodeEnv = env.NODE_ENV?.trim() || DEFAULTS.nodeEnv;
  const temporalAddress = env.TEMPORAL_ADDRESS?.trim() || undefined;
  const workflowMode = env.ENCOIS_WORKFLOW_MODE?.trim() ||
    (!temporalAddress && (nodeEnv === "development" || nodeEnv === "test") ? "memory" : "temporal");
  if (workflowMode !== "memory" && workflowMode !== "database" && workflowMode !== "temporal") {
    throw new Error(`Unsupported ENCOIS_WORKFLOW_MODE ${workflowMode}`);
  }
  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const identityPlatformAllowedSignInProviders = (env.IDENTITY_PLATFORM_ALLOWED_SIGN_IN_PROVIDERS ?? "google.com")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);

  return {
    bodyLimitBytes: positiveInteger(env.BODY_LIMIT_BYTES, DEFAULTS.bodyLimitBytes),
    corsCredentials: env.CORS_CREDENTIALS === "true",
    corsOrigins,
    host: env.HOST?.trim() || DEFAULTS.host,
    identityPlatformProjectId: env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || undefined,
    sourceArtifactBucket: env.SOURCE_ARTIFACT_BUCKET?.trim() || undefined,
    identityPlatformAllowedSignInProviders,
    controlPlaneServiceToken: env.CONTROL_PLANE_SERVICE_TOKEN?.trim() || undefined,
    controlPlaneServiceUserId: env.CONTROL_PLANE_SERVICE_USER_ID?.trim() || undefined,
    nodeEnv,
    port: positiveInteger(env.PORT, DEFAULTS.port),
    requestTimeoutMs: positiveInteger(env.REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    agentGatewayPolicyVersion: env.AGENT_GATEWAY_POLICY_VERSION?.trim() || "policy-read-only-fixture-v1",
    agentGatewayCapabilitySecret:
      env.AGENT_GATEWAY_CAPABILITY_SECRET?.trim() ||
      ((nodeEnv === "development" || nodeEnv === "test") ? "local-execution-capability-secret" : undefined),
    executionCapabilityTtlMs: positiveInteger(env.AGENT_GATEWAY_CAPABILITY_TTL_MS, 86_400_000),
    workflowMode,
    temporalAddress,
    temporalApiKey: env.TEMPORAL_API_KEY?.trim() || undefined,
    temporalTlsClientCertPath: env.TEMPORAL_TLS_CLIENT_CERT_PATH?.trim() || undefined,
    temporalTlsClientKeyPath: env.TEMPORAL_TLS_CLIENT_KEY_PATH?.trim() || undefined,
    temporalNamespace: env.TEMPORAL_NAMESPACE?.trim() || "default",
    temporalTaskQueue: env.TEMPORAL_TASK_QUEUE?.trim() || "encois-agent-runtime",
  };
}
