export type AppConfig = {
  bodyLimitBytes: number;
  corsCredentials: boolean;
  corsOrigins: readonly string[];
  host: string;
  publicBaseUrl?: string;
  identityPlatformProjectId?: string;
  sourceArtifactBucket?: string;
  identityPlatformAllowedSignInProviders?: readonly string[];
  controlPlaneServiceToken?: string;
  controlPlaneServiceUserId?: string;
  agentGatewayUrl?: string;
  agentGatewayServiceToken?: string;
  agentGatewayAudience?: string;
  agentGatewayServiceAccountEmail?: string;
  agentRuntimeUrl?: string;
  agentRuntimeServiceToken?: string;
  agentRuntimeAudience?: string;
  integrationOAuthConfigJson?: string;
  integrationOAuthCallbackUrl?: string;
  integrationOAuthStateSecret?: string;
  integrationOAuthSuccessUrl?: string;
  nodeEnv: string;
  port: number;
  requestTimeoutMs: number;
  agentGatewayPolicyVersion: string;
  agentGatewayCapabilitySecret?: string;
  executionCapabilityTtlMs: number;
  workflowMode: "temporal";
  temporalAddress?: string;
  temporalApiKey?: string;
  temporalTlsClientCertPath?: string;
  temporalTlsClientKeyPath?: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
  workflowRunRetentionDays: number;
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
  const configuredWorkflowMode = env.ENCOIS_WORKFLOW_MODE?.trim();
  if (configuredWorkflowMode && configuredWorkflowMode !== "temporal") {
    throw new Error(
      `ENCOIS_WORKFLOW_MODE must be temporal; product workflow fixtures are not supported by the API.`,
    );
  }
  const workflowMode = "temporal" as const;
  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const identityPlatformAllowedSignInProviders = (
    env.IDENTITY_PLATFORM_ALLOWED_SIGN_IN_PROVIDERS ?? "google.com"
  )
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  if (nodeEnv === "production") {
    if (env.FIREBASE_AUTH_EMULATOR_HOST?.trim()) {
      throw new Error(
        "FIREBASE_AUTH_EMULATOR_HOST must not be configured in production.",
      );
    }
    if (
      identityPlatformAllowedSignInProviders.length !== 1 ||
      identityPlatformAllowedSignInProviders[0] !== "google.com"
    ) {
      throw new Error(
        "Production Identity Platform authentication must allow only google.com.",
      );
    }
  }

  return {
    bodyLimitBytes: positiveInteger(
      env.BODY_LIMIT_BYTES,
      DEFAULTS.bodyLimitBytes,
    ),
    corsCredentials: env.CORS_CREDENTIALS === "true",
    corsOrigins,
    host: env.HOST?.trim() || DEFAULTS.host,
    publicBaseUrl: env.ENCOIS_PUBLIC_BASE_URL?.trim() || undefined,
    identityPlatformProjectId:
      env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || undefined,
    sourceArtifactBucket: env.SOURCE_ARTIFACT_BUCKET?.trim() || undefined,
    identityPlatformAllowedSignInProviders,
    controlPlaneServiceToken:
      env.CONTROL_PLANE_SERVICE_TOKEN?.trim() || undefined,
    controlPlaneServiceUserId:
      env.CONTROL_PLANE_SERVICE_USER_ID?.trim() || undefined,
    agentGatewayUrl: env.AGENT_GATEWAY_URL?.trim() || undefined,
    agentGatewayServiceToken:
      env.AGENT_GATEWAY_SERVICE_TOKEN?.trim() || undefined,
    agentGatewayAudience: env.AGENT_GATEWAY_AUDIENCE?.trim() || undefined,
    agentGatewayServiceAccountEmail:
      env.AGENT_GATEWAY_SERVICE_ACCOUNT_EMAIL?.trim() || undefined,
    agentRuntimeUrl: env.AGENT_RUNTIME_URL?.trim() || undefined,
    agentRuntimeServiceToken:
      env.AGENT_RUNTIME_SERVICE_TOKEN?.trim() || undefined,
    agentRuntimeAudience: env.AGENT_RUNTIME_AUDIENCE?.trim() || undefined,
    integrationOAuthConfigJson:
      env.ENCOIS_INTEGRATION_OAUTH_CONFIG_JSON?.trim() || undefined,
    integrationOAuthCallbackUrl:
      env.ENCOIS_INTEGRATION_OAUTH_CALLBACK_URL?.trim() || undefined,
    integrationOAuthStateSecret:
      env.ENCOIS_INTEGRATION_OAUTH_STATE_SECRET?.trim() || undefined,
    integrationOAuthSuccessUrl:
      env.ENCOIS_INTEGRATION_OAUTH_SUCCESS_URL?.trim() || undefined,
    nodeEnv,
    port: positiveInteger(env.PORT, DEFAULTS.port),
    requestTimeoutMs: positiveInteger(
      env.REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
    ),
    agentGatewayPolicyVersion:
      env.AGENT_GATEWAY_POLICY_VERSION?.trim() || "policy-read-only-fixture-v1",
    agentGatewayCapabilitySecret:
      env.AGENT_GATEWAY_CAPABILITY_SECRET?.trim() ||
      (nodeEnv === "development" || nodeEnv === "test"
        ? "local-execution-capability-secret"
        : undefined),
    executionCapabilityTtlMs: positiveInteger(
      env.AGENT_GATEWAY_CAPABILITY_TTL_MS,
      86_400_000,
    ),
    workflowMode,
    temporalAddress,
    temporalApiKey: env.TEMPORAL_API_KEY?.trim() || undefined,
    temporalTlsClientCertPath:
      env.TEMPORAL_TLS_CLIENT_CERT_PATH?.trim() || undefined,
    temporalTlsClientKeyPath:
      env.TEMPORAL_TLS_CLIENT_KEY_PATH?.trim() || undefined,
    temporalNamespace: env.TEMPORAL_NAMESPACE?.trim() || "encois",
    temporalTaskQueue:
      env.TEMPORAL_TASK_QUEUE?.trim() || "encois-agent-runtime",
    workflowRunRetentionDays: positiveInteger(
      env.WORKFLOW_RUN_RETENTION_DAYS,
      30,
    ),
  };
}
