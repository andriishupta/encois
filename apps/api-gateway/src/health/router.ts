import { type Handler, Hono } from "hono";
import type { AppConfig } from "../config.js";
import { databaseClient } from "../database.js";
import type { GatewayEnv } from "../middleware/aos.js";
import { fetchCloudRunIdentityToken } from "../security/cloud-run-identity-token.js";

type ReadinessState = "ok" | "not_configured" | "failed";

type ReadinessCheck = {
  state: ReadinessState;
  required: boolean;
};

export type ReadinessProbe = () => Promise<
  Readonly<Record<string, ReadinessCheck>>
>;
type DatabaseSchemaProbe = () => Promise<boolean>;

// This marker is created by the latest committed control-plane migration. A
// connection-only probe would allow a Cloud Run revision to receive traffic
// before the protected migration Job has applied the schema it imports.
const currentSchemaMarker = "organization_onboarding";

function configured(
  value: string | undefined,
  required: boolean,
): ReadinessCheck {
  return { state: value ? "ok" : "not_configured", required };
}

export async function checkDatabase(
  schemaProbe?: DatabaseSchemaProbe,
): Promise<ReadinessState> {
  const client = databaseClient;
  if (!client && !schemaProbe) return "not_configured";
  try {
    if (schemaProbe) return (await schemaProbe()) ? "ok" : "failed";
    if (!client) return "not_configured";
    const schemaReady = Boolean(
      (
        await client.unsafe("select to_regclass($1) as schema_marker", [
          "public." + currentSchemaMarker,
        ])
      )[0]?.schema_marker,
    );
    return schemaReady ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

function hasOAuthProviderConfig(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length > 0,
    );
  } catch {
    return false;
  }
}

async function checkHttpReadiness(
  baseUrl: string | undefined,
  options: {
    audience?: string;
    serviceToken?: string;
    fetchImpl: typeof fetch;
    timeoutMs: number;
  },
): Promise<ReadinessState> {
  if (!baseUrl || !options.serviceToken) return "not_configured";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const identityToken = options.audience
      ? await fetchCloudRunIdentityToken(options.audience, options.fetchImpl)
      : undefined;
    const response = await options.fetchImpl(
      `${baseUrl.replace(/\/$/u, "")}/health/ready`,
      {
        headers: {
          Accept: "application/json",
          ...(identityToken
            ? { Authorization: `Bearer ${identityToken}` }
            : {}),
        },
        signal: controller.signal,
      },
    );
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}

export function createReadinessProbe(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): ReadinessProbe {
  return async () => {
    const required = config.nodeEnv === "production";
    const databaseState = await checkDatabase();
    const temporalConfigured =
      config.workflowMode === "temporal" &&
      Boolean(config.temporalAddress && config.temporalNamespace);
    const oauthConfigured =
      hasOAuthProviderConfig(config.integrationOAuthConfigJson) &&
      Boolean(
        config.integrationOAuthCallbackUrl &&
          config.integrationOAuthStateSecret,
      );
    const corsConfigured =
      config.corsOrigins.length > 0 &&
      config.corsOrigins.every((origin) => origin.startsWith("https://"));
    const runtimeProbeTimeoutMs = Math.min(config.requestTimeoutMs, 2_000);
    const [agentGatewayState, agentRuntimeState] = await Promise.all([
      checkHttpReadiness(config.agentGatewayUrl, {
        audience: config.agentGatewayAudience,
        serviceToken: config.agentGatewayServiceToken,
        fetchImpl,
        timeoutMs: runtimeProbeTimeoutMs,
      }),
      checkHttpReadiness(config.agentRuntimeUrl, {
        audience: config.agentRuntimeAudience,
        serviceToken: config.agentRuntimeServiceToken,
        fetchImpl,
        timeoutMs: runtimeProbeTimeoutMs,
      }),
    ]);

    return {
      database: { state: databaseState, required },
      identityPlatform: configured(config.identityPlatformProjectId, required),
      temporal: {
        state: temporalConfigured ? "ok" : "not_configured",
        required,
      },
      executionCapability: configured(
        config.agentGatewayCapabilitySecret,
        required,
      ),
      oauth: { state: oauthConfigured ? "ok" : "not_configured", required },
      artifactStore: configured(config.sourceArtifactBucket, required),
      agentGateway: { state: agentGatewayState, required },
      agentRuntime: { state: agentRuntimeState, required },
      cors: { state: corsConfigured ? "ok" : "not_configured", required },
    };
  };
}

export function createHealthRouter(
  config: AppConfig,
  probe: ReadinessProbe = createReadinessProbe(config),
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.get("/live", (context) =>
    context.json({
      data: {
        status: "ok",
      },
    }),
  );

  const readyHandler: Handler<GatewayEnv> = async (context) => {
    const checks = await probe();
    const failedRequired = Object.entries(checks).filter(
      ([, check]) => check.required && check.state !== "ok",
    );
    const ready = failedRequired.length === 0;

    return context.json(
      {
        data: {
          status: ready ? "ok" : "unavailable",
          checks: Object.fromEntries(
            Object.entries(checks).map(([name, check]) => [name, check.state]),
          ),
        },
      },
      ready ? 200 : 503,
    );
  };

  router.get("/ready", readyHandler);
  router.get("/", readyHandler);

  return router;
}
