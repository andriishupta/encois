import { fetchCloudRunIdentityToken } from "./security/cloud-run-identity-token.js";

const organizationId =
  process.env.INTEGRATION_HEALTH_DISPATCH_ORGANIZATION_ID?.trim();
const controlPlaneUrl = process.env.CONTROL_PLANE_URL?.trim();
const serviceToken = process.env.CONTROL_PLANE_SERVICE_TOKEN?.trim();
const audience = process.env.CONTROL_PLANE_AUDIENCE?.trim() || controlPlaneUrl;
const timeoutMs = Number(
  process.env.INTEGRATION_HEALTH_DISPATCH_TIMEOUT_MS ?? "30000",
);

if (
  !organizationId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    organizationId,
  )
) {
  throw new Error(
    "INTEGRATION_HEALTH_DISPATCH_ORGANIZATION_ID must be a valid organization UUID",
  );
}
if (!controlPlaneUrl) throw new Error("CONTROL_PLANE_URL is required");
if (!serviceToken) throw new Error("CONTROL_PLANE_SERVICE_TOKEN is required");
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
  throw new Error(
    "INTEGRATION_HEALTH_DISPATCH_TIMEOUT_MS must be an integer between 1000 and 120000",
  );
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const identityToken = audience
    ? await fetchCloudRunIdentityToken(audience, fetch)
    : undefined;
  const response = await fetch(
    `${controlPlaneUrl.replace(/\/$/u, "")}/api/v1/internal/integrations/health-check`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Encois-Service-Token": serviceToken,
        "X-Organization-ID": organizationId,
        "X-Actor-ID": "integration-health-dispatcher",
        ...(identityToken ? { Authorization: `Bearer ${identityToken}` } : {}),
      },
      body: "{}",
      signal: controller.signal,
    },
  );

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok)
    throw new Error(
      `integration health dispatcher returned HTTP ${response.status}`,
    );

  const envelope =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const data =
    envelope?.data &&
    typeof envelope.data === "object" &&
    !Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>)
      : null;
  const summary = data
    ? {
        checked: typeof data.checked === "number" ? data.checked : 0,
        succeeded: typeof data.succeeded === "number" ? data.succeeded : 0,
        failed: typeof data.failed === "number" ? data.failed : 0,
      }
    : { checked: 0, succeeded: 0, failed: 0 };
  console.info(
    JSON.stringify({
      event: "integration_health.dispatch_completed",
      organizationId,
      ...summary,
    }),
  );
} finally {
  clearTimeout(timeout);
}
