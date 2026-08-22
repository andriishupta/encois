import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { WorkflowClient } from "./workflows/temporal-client.js";
import type { WorkflowExecutionProjection } from "./workflows/types.js";
import type { WebhookPayloadStore } from "./webhooks/payload-store.js";

const testConfig: AppConfig = {
  bodyLimitBytes: 1_048_576,
  corsCredentials: false,
  corsOrigins: ["http://localhost:5173"],
  host: "127.0.0.1",
  nodeEnv: "test",
  port: 8787,
  requestTimeoutMs: 10_000,
  agentGatewayPolicyVersion: "policy-read-only-fixture-v1",
  agentGatewayCapabilitySecret: "test-capability-secret",
  agentGatewayUrl: "http://agent-gateway.test",
  agentGatewayServiceToken: "test-agent-token",
  agentRuntimeUrl: "http://agent-runtime.test",
  agentRuntimeServiceToken: "test-runtime-token",
  executionCapabilityTtlMs: 86_400_000,
  workflowMode: "memory",
  temporalNamespace: "default",
  temporalTaskQueue: "test",
  workflowRunRetentionDays: 30,
};

const noOpWorkflowClient: WorkflowClient = {
  async start() {
    throw new Error("workflow client is not part of this test");
  },
  async get() {
    return null;
  },
  async list() {
    return [];
  },
  async signal() {},
  async signalCoordinator() {},
  async update() {},
  async cancel() {},
};

describe("API Gateway", () => {
  it("fails closed when production capability signing is not configured", () => {
    expect(() =>
      createApp({
        config: { ...testConfig, nodeEnv: "production", agentGatewayCapabilitySecret: undefined },
      }),
    ).toThrow("AGENT_GATEWAY_CAPABILITY_SECRET is required in production.");
  });

  it("exposes public liveness and readiness endpoints", async () => {
    const app = createApp({ config: testConfig });

    const response = await app.request("/health/live", {
      headers: { traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-trace-id")).toBe("0123456789abcdef0123456789abcdef");
    expect((await app.request("/health/ready")).status).toBe(200);
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/healthz/live")).status).toBe(200);
    expect((await app.request("/healthz/ready")).status).toBe(200);
  });

  it("fails production readiness when required runtime dependencies are missing", async () => {
    const app = createApp({
      config: {
        ...testConfig,
        nodeEnv: "production",
        workflowMode: "temporal",
        temporalAddress: "temporal.example:7233",
        identityPlatformProjectId: "encois-production",
        integrationOAuthConfigJson: "{}",
        integrationOAuthCallbackUrl: "https://app.example/api/v1/integrations/authorization/callback",
        integrationOAuthStateSecret: "a-production-state-secret-that-is-long-enough",
        sourceArtifactBucket: "encois-production-artifacts",
        corsOrigins: ["https://app.example"],
      },
    });

    const response = await app.request("/health/ready");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "unavailable",
        checks: {
          database: "not_configured",
          agentGateway: "failed",
          agentRuntime: "failed",
        },
      },
    });
  });

  it("fails closed when AOS is not configured", async () => {
    const app = createApp({ config: testConfig });
    const response = await app.request("/api/v1/integrations");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTHENTICATION_UNAVAILABLE" },
    });
  });

  it("keeps webhook receipt public while validating its signed boundary", async () => {
    const app = createApp({ config: testConfig });
    const response = await app.request("/api/v1/webhooks/00000000-0000-4000-8000-000000000001/github-events", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_WEBHOOK_HEADERS" } });
  });

  it("mounts the integration webhook lifecycle behind the authenticated boundary", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002", scope: ["root"], permissions: ["integrations:read", "integrations:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const invalid = await app.request("/api/v1/integrations/00000000-0000-4000-8000-000000000003/webhook", {
      method: "POST",
      body: JSON.stringify({ endpointKey: 42 }),
      headers: { "content-type": "application/json" },
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "INVALID_WEBHOOK_ENDPOINT_KEY" } });

    const unavailable = await app.request("/api/v1/integrations/00000000-0000-4000-8000-000000000003/webhook");
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("exposes tenant-protected workflow templates with a hard result limit", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["root"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const invalidLimit = await app.request("/api/v1/workflows/templates?q=github&limit=11");
    expect(invalidLimit.status).toBe(400);

    const unavailable = await app.request("/api/v1/workflows/templates?q=github,jira&limit=10");
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: "PERSISTENCE_UNAVAILABLE" },
    });
  });

  it("mounts the Blueprint lifecycle proposal boundary and rejects unversioned requests", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["root"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const invalid = await app.request("/api/v1/workflows/blueprints/release-readiness/lifecycle", {
      method: "POST",
      body: JSON.stringify({ action: "deprecate", reason: "Retire the old revision." }),
      headers: { "content-type": "application/json" },
    });
    expect(invalid.status).toBe(400);

    const unavailable = await app.request("/api/v1/workflows/blueprints/release-readiness/lifecycle", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: "workflow-blueprint-lifecycle.v1",
        action: "deprecate",
        sourceVersion: "1.0.0",
        reason: "Retire the old revision.",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("resolves workflow creation intents behind the product-level boundary", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["root"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const invalid = await app.request("/api/v1/workflows/plans/preview", {
      method: "POST",
      body: JSON.stringify({ mode: "template", name: "Missing source" }),
      headers: { "content-type": "application/json" },
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "WORKFLOW_TEMPLATE_REQUIRED" } });

    const manual = await app.request("/api/v1/workflows/plans/preview", {
      method: "POST",
      body: JSON.stringify({ mode: "manual", name: "Manual investigation", prompt: "Investigate release blockers" }),
      headers: { "content-type": "application/json" },
    });
    expect(manual.status).toBe(422);
    await expect(manual.json()).resolves.toMatchObject({ error: { code: "MANUAL_PROVIDER_REQUIRED" } });

    const unsupportedProvider = await app.request("/api/v1/workflows/plans/preview", {
      method: "POST",
      body: JSON.stringify({ mode: "manual", name: "Linear investigation", prompt: "Investigate Linear blockers" }),
      headers: { "content-type": "application/json" },
    });
    expect(unsupportedProvider.status).toBe(422);
    await expect(unsupportedProvider.json()).resolves.toMatchObject({ error: { code: "WORKFLOW_PROVIDER_UNSUPPORTED" } });

    const missingProvider = await app.request("/api/v1/workflows/plans/preview", {
      method: "POST",
      body: JSON.stringify({ mode: "manual", name: "Generic investigation", prompt: "Investigate the release" }),
      headers: { "content-type": "application/json" },
    });
    expect(missingProvider.status).toBe(422);
    await expect(missingProvider.json()).resolves.toMatchObject({ error: { code: "MANUAL_PROVIDER_REQUIRED" } });
  });

  it("exposes authentication status separately from tenant-protected routes", async () => {
    const app = createApp({
      config: testConfig,
      verifyIdentity: async () => ({
        identity: {
          email: "admin@example.com",
          emailVerified: true,
          identityProvider: "identity-platform" as const,
          signInProvider: "google.com",
          subject: "identity-1",
        },
        status: "authenticated" as const,
      }),
      resolveAccess: async () => ({ status: "pending" as const }),
    });

    const response = await app.request("/api/v1/auth/me", {
      headers: { authorization: "Bearer fixture-id-token" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "pending" } });
  });

  it("returns active auth status without exposing the protected route middleware", async () => {
    const app = createApp({
      config: testConfig,
      verifyIdentity: async () => ({
        identity: {
          email: "admin@example.com",
          emailVerified: true,
          identityProvider: "identity-platform" as const,
          signInProvider: "google.com",
          subject: "identity-1",
        },
        status: "authenticated" as const,
      }),
      resolveAccess: async () => ({
        principal: {
          actorId: "identity-1",
          userId: "user-1",
          organizationId: "org-1",
          scope: ["root"],
          permissions: ["onboarding:manage", "workflows:read"],
        },
        status: "active" as const,
      }),
    });

    const response = await app.request("/api/v1/auth/me", {
      headers: { authorization: "Bearer fixture-id-token" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "active",
        userId: "user-1",
        organizationId: "org-1",
        permissions: ["onboarding:manage", "workflows:read"],
      },
    });
  });

  it("fails waitlist submission closed when persistence is unavailable", async () => {
    const app = createApp({ config: testConfig });
    const response = await app.request("/api/v1/public/waitlist", {
      method: "POST",
      body: JSON.stringify({
        email: "person@company.example",
        companyName: "Example Company",
        companyWebsite: "https://company.example",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("validates waitlist qualification before checking persistence", async () => {
    const app = createApp({ config: testConfig });
    const response = await app.request("/api/v1/public/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "person@gmail.com", companyName: "Example Company" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST", field: "email" },
    });
  });

  it("fails closed when persistence is not configured", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/integrations");

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("mounts tenant-protected organization units and permissions endpoints", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["root"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const invalidUnit = await app.request("/api/v1/organization/units", {
      method: "POST",
      body: JSON.stringify({ name: "Platform" }),
      headers: { "content-type": "application/json" },
    });
    expect(invalidUnit.status).toBe(400);
    await expect(invalidUnit.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });

    const organization = await app.request("/api/v1/organization");
    expect(organization.status).toBe(503);
    await expect(organization.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });

    for (const path of ["/api/v1/organization/units", "/api/v1/organization/members", "/api/v1/organization/permissions"]) {
      const response = await app.request(path);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
    }

    const invalidPermission = await app.request("/api/v1/organization/permissions", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-1" }),
      headers: { "content-type": "application/json" },
    });
    expect(invalidPermission.status).toBe(400);

    const invalidUpdate = await app.request("/api/v1/organization/permissions/not-a-uuid", {
      method: "PATCH",
      body: JSON.stringify({ access: "admin" }),
      headers: { "content-type": "application/json" },
    });
    expect(invalidUpdate.status).toBe(400);

    const invalidDelete = await app.request("/api/v1/organization/permissions/not-a-uuid", { method: "DELETE" });
    expect(invalidDelete.status).toBe(400);
  });

  it("mounts tenant-protected Knowledge Source routes and rejects non-PDF uploads at the boundary", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["root"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const list = await app.request("/api/v1/sources");
    expect(list.status).toBe(503);
    await expect(list.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });

    const form = new FormData();
    form.set("file", new File(["plain text"], "notes.txt", { type: "text/plain" }));
    const upload = await app.request("/api/v1/sources/uploads", { method: "POST", body: form });
    expect(upload.status).toBe(422);
    await expect(upload.json()).resolves.toMatchObject({ error: { code: "UNSUPPORTED_DOCUMENT_TYPE" } });
  });

  it("starts and reads a workflow through the local Temporal blueprint", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const startResponse = await app.request("/api/v1/workflows", {
      body: JSON.stringify({
        workflowType: "encois.user-blueprint.v1",
        key: "release-1",
        input: {
          blueprint: {
            contractVersion: "workflow-blueprint.v1",
            blueprintId: "release-readiness",
            version: "1.0.0",
            name: "Release readiness",
            workflowType: "encois.user-blueprint.v1",
            purpose: "Verify release readiness from approved evidence.",
            enabled: true,
            steps: [{ id: "transform", kind: "transform", input: { status: "ready" } }],
          },
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(startResponse.status).toBe(202);
    const started = (await startResponse.json()) as { data: { workflowId: string } };

    const getResponse = await app.request(`/api/v1/workflows/${started.data.workflowId}`);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      data: { organizationId: "org-1", status: "queued", workflowType: "encois.user-blueprint.v1" },
    });

    const eventsResponse = await app.request(`/api/v1/workflows/${started.data.workflowId}/events`);
    expect(eventsResponse.status).toBe(200);
    await expect(eventsResponse.json()).resolves.toEqual({ data: [] });

    const activityResponse = await app.request("/api/v1/workflows/activity");
    expect(activityResponse.status).toBe(200);
    await expect(activityResponse.json()).resolves.toEqual({ data: [] });
  });

  it("rejects workflow reads when the principal has no workflow permission", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["engineering"], permissions: [] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const response = await app.request("/api/v1/workflows");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("protects the private Coordinator control-plane route with a service credential", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "agent-runtime",
          organizationId: "org-1",
          scope: ["engineering"],
          permissions: ["workflows:run"],
        },
        status: "authenticated" as const,
      }),
      config: { ...testConfig, controlPlaneServiceToken: "control-plane-token" },
    });

    const denied = await app.request("/api/v1/internal/coordinator/workflows", {
      body: JSON.stringify({ workflowType: "encois.user-blueprint.v1" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(denied.status).toBe(401);

    const rejectedInlineBlueprint = await app.request("/api/v1/internal/coordinator/workflows", {
      body: JSON.stringify({
        workflowType: "encois.user-blueprint.v1",
        key: "internal-release-1",
        input: {
          blueprint: {
            contractVersion: "workflow-blueprint.v1",
            blueprintId: "release-readiness",
            version: "1.0.0",
            name: "Release readiness",
            workflowType: "encois.user-blueprint.v1",
            purpose: "Verify release readiness from approved evidence.",
            enabled: true,
            steps: [{ id: "transform", kind: "transform", input: { status: "ready" } }],
          },
        },
      }),
      headers: {
        "content-type": "application/json",
        "X-Encois-Service-Token": "control-plane-token",
        "X-Organization-ID": "org-1",
      },
      method: "POST",
    });
    expect(rejectedInlineBlueprint.status).toBe(422);
    await expect(rejectedInlineBlueprint.json()).resolves.toMatchObject({
      error: { code: "BLUEPRINT_REGISTRY_REFERENCE_REQUIRED" },
    });

    const unresolvedReference = await app.request("/api/v1/internal/coordinator/workflows", {
      body: JSON.stringify({
        workflowType: "encois.user-blueprint.v1",
        key: "internal-release-1",
        blueprintId: "release-readiness",
        blueprintVersion: "1.0.0",
      }),
      headers: {
        "content-type": "application/json",
        "X-Encois-Service-Token": "control-plane-token",
        "X-Organization-ID": "org-1",
      },
      method: "POST",
    });
    expect(unresolvedReference.status).toBe(503);
  });

  it("protects provider authorization and rejects raw credential values", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "provider-adapter", organizationId: "org-1", scope: ["engineering"] },
        status: "authenticated" as const,
      }),
      config: { ...testConfig, controlPlaneServiceToken: "control-plane-token" },
    });
    const path = "/api/v1/internal/integrations/integration-1/authorization";
    const denied = await app.request(path, { method: "POST", body: JSON.stringify({ credentialRef: "secretmanager://projects/demo/secrets/github" }), headers: { "content-type": "application/json" } });
    expect(denied.status).toBe(401);

    const rawCredential = await app.request(path, {
      method: "POST",
      body: JSON.stringify({ credentialRef: "raw-token-value" }),
      headers: { "content-type": "application/json", "X-Encois-Service-Token": "control-plane-token", "X-Organization-ID": "org-1" },
    });
    expect(rawCredential.status).toBe(422);
    await expect(rawCredential.json()).resolves.toMatchObject({ error: { code: "INVALID_CREDENTIAL_REFERENCE" } });

    const directPromotion = await app.request(path, {
      method: "POST",
      body: JSON.stringify({ credentialRef: "secretmanager://projects/demo/secrets/github", status: "active" }),
      headers: { "content-type": "application/json", "X-Encois-Service-Token": "control-plane-token", "X-Organization-ID": "org-1" },
    });
    expect(directPromotion.status).toBe(400);

    const healthPath = "/api/v1/internal/integrations/health";
    const deniedHealth = await app.request(healthPath, {
      method: "POST",
      body: JSON.stringify({ integrationId: "integration-1", status: "needs_reauth" }),
      headers: { "content-type": "application/json" },
    });
    expect(deniedHealth.status).toBe(401);

    const unavailableHealth = await app.request(healthPath, {
      method: "POST",
      body: JSON.stringify({ integrationId: "integration-1", status: "needs_reauth", lastError: "Provider rejected the credential." }),
      headers: { "content-type": "application/json", "X-Encois-Service-Token": "control-plane-token", "X-Organization-ID": "org-1" },
    });
    expect(unavailableHealth.status).toBe(503);
    await expect(unavailableHealth.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });

    const scheduledHealthPath = "/api/v1/internal/integrations/health-check";
    const deniedScheduledHealth = await app.request(scheduledHealthPath, { method: "POST" });
    expect(deniedScheduledHealth.status).toBe(401);

    const unavailableScheduledHealth = await app.request(scheduledHealthPath, {
      method: "POST",
      headers: { "X-Encois-Service-Token": "control-plane-token", "X-Organization-ID": "org-1" },
      body: JSON.stringify({}),
    });
    expect(unavailableScheduledHealth.status).toBe(503);
    await expect(unavailableScheduledHealth.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("rejects local credential references in production authorization boundaries", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "agent-gateway", organizationId: "org-1", scope: ["*"] },
        status: "authenticated" as const,
      }),
      config: {
        ...testConfig,
        nodeEnv: "production",
        controlPlaneServiceToken: "control-plane-token",
      },
      workflowClient: noOpWorkflowClient,
      webhookPayloadStore: {} as WebhookPayloadStore,
    });

    const response = await app.request("/api/v1/internal/integrations/integration-1/authorization", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Encois-Service-Token": "control-plane-token",
      },
      body: JSON.stringify({ credentialRef: "local://fixture-token", status: "authorized" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_CREDENTIAL_REFERENCE" },
    });
  });

  it("mounts the browser-facing authorization start boundary without exposing credentials", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["root"], permissions: ["integrations:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/integrations/integration-1/authorization/start", { method: "POST" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("validates a workflow change plan without applying it", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["team-engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/workflows/plans/validate", {
      body: JSON.stringify({
        contractVersion: "workflow-change-plan.v1",
        planId: "plan-release-readiness-1",
        coordinatorId: "coordinator-org-1",
        organizationId: "org-1",
        observedAt: "2026-08-20T16:00:00.000Z",
        changes: [{
          kind: "create",
          blueprint: {
            contractVersion: "workflow-blueprint.v1",
            blueprintId: "release-readiness",
            version: "1.0.0",
            name: "Release readiness",
            workflowType: "encois.user-blueprint.v1",
            purpose: "Check release readiness.",
            enabled: true,
            requiredScopes: ["team-engineering"],
            steps: [{ id: "transform", kind: "transform", input: { status: "ready" } }],
          },
          reason: "Create the approved release readiness workflow.",
          requiresApproval: true,
        }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        planId: "plan-release-readiness-1",
        status: "validated_not_applied",
        applyStatus: "deferred_persistence_and_approval",
        approvalRequired: true,
      },
    });
  });

  it("validates lifecycle workflow-change-plan.v1 targets without applying them", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["team-engineering"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/workflows/plans/validate", {
      body: JSON.stringify({
        contractVersion: "workflow-change-plan.v1",
        planId: "plan-release-lifecycle-1",
        coordinatorId: "coordinator-org-1",
        organizationId: "org-1",
        observedAt: "2026-08-20T16:00:00.000Z",
        changes: [
          {
            kind: "update",
            targetBlueprintId: "release-readiness",
            targetBlueprintVersion: "1.0.0",
            blueprint: {
              contractVersion: "workflow-blueprint.v1",
              blueprintId: "release-readiness",
              version: "2.0.0",
              name: "Release readiness v2",
              workflowType: "encois.user-blueprint.v1",
              purpose: "Check release readiness.",
              enabled: true,
              steps: [{ id: "transform", kind: "transform", input: { status: "ready" } }],
            },
            reason: "Publish a new revision.",
            requiresApproval: true,
          },
          {
            kind: "deprecate",
            targetBlueprintId: "release-readiness",
            targetBlueprintVersion: "0.9.0",
            reason: "Retire the obsolete revision.",
            requiresApproval: true,
          },
          {
            kind: "cancel",
            targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:release-1",
            reason: "Cancel the superseded execution.",
            requiresApproval: true,
          },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { planId: "plan-release-lifecycle-1", status: "validated_not_applied", changeCount: 3 },
    });
  });

  it("rejects lifecycle plans that mix Blueprint and Temporal targets", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["team-engineering"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/workflows/plans/validate", {
      body: JSON.stringify({
        contractVersion: "workflow-change-plan.v1",
        planId: "plan-invalid-lifecycle-1",
        coordinatorId: "coordinator-org-1",
        organizationId: "org-1",
        observedAt: "2026-08-20T16:00:00.000Z",
        changes: [{
          kind: "deprecate",
          targetBlueprintId: "release-readiness",
          targetBlueprintVersion: "1.0.0",
          targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:release-1",
          reason: "Ambiguous target.",
          requiresApproval: true,
        }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects workflow change plans outside the caller organization", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["team-engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/workflows/plans/validate", {
      body: JSON.stringify({
        contractVersion: "workflow-change-plan.v1",
        planId: "plan-cross-tenant",
        coordinatorId: "coordinator-org-2",
        organizationId: "org-2",
        observedAt: "2026-08-20T16:00:00.000Z",
        changes: [{
          kind: "cancel",
          targetWorkflowId: "workflow:org-2:encois.user-blueprint.v1:release-1",
          reason: "Retire the workflow.",
          requiresApproval: true,
        }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("does not accept plan persistence or approval when the database is unavailable", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["team-engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const plan = {
      contractVersion: "workflow-change-plan.v1",
      planId: "plan-persistence-unavailable",
      coordinatorId: "coordinator-org-1",
      organizationId: "org-1",
      observedAt: "2026-08-20T16:00:00.000Z",
      changes: [{
        kind: "cancel",
        targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:release-1",
        reason: "Retire the obsolete workflow.",
        requiresApproval: true,
      }],
    };

    const submit = await app.request("/api/v1/workflows/plans", {
      body: JSON.stringify(plan),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(submit.status).toBe(503);
    await expect(submit.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });

    const list = await app.request("/api/v1/workflows/plans");
    expect(list.status).toBe(503);
    await expect(list.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });

    const approve = await app.request("/api/v1/workflows/plans/plan-persistence-unavailable/approve", {
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(approve.status).toBe(503);
    await expect(approve.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });

    const apply = await app.request("/api/v1/workflows/plans/plan-persistence-unavailable/apply", {
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(apply.status).toBe(503);
    await expect(apply.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("fails closed when Run again has no persisted lineage", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["team-engineering"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const response = await app.request("/api/v1/workflows/workflow:org-1:encois.user-blueprint.v1:terminal/rerun", { method: "POST" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("fails closed when a workflow references a stored Blueprint without persistence", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["team-engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });

    const response = await app.request("/api/v1/workflows", {
      body: JSON.stringify({
        workflowType: "encois.user-blueprint.v1",
        blueprintId: "release-readiness",
        blueprintVersion: "1.0.0",
        key: "stored-blueprint-smoke",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "BLUEPRINT_REGISTRY_UNAVAILABLE" } });
  });

  it("starts and reuses one generic Blueprint execution for the same key", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["team-engineering"],
          permissions: ["workflows:manage"],
        },
        status: "authenticated" as const,
      }),
      config: testConfig,
    });
    const request = {
      workflowType: "encois.user-blueprint.v1",
      key: "project-context-demo",
      input: { projectKey: "DEMO" },
      blueprint: {
        contractVersion: "workflow-blueprint.v1",
        blueprintId: "project-context",
        version: "1.0.0",
        name: "Project context",
        workflowType: "encois.user-blueprint.v1",
        purpose: "Collect project context.",
        enabled: true,
        steps: [
          { id: "source", kind: "tool", tool: "jira.project_tasks" },
          { id: "summary", kind: "agent", agentDefinition: "context.synthesizer@1", dependsOn: ["source"] },
        ],
      },
    };

    const first = await app.request("/api/v1/workflows", {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const second = await app.request("/api/v1/workflows", {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { data: { workflowId: string; reused: boolean } };
    const secondBody = (await second.json()) as { data: { workflowId: string; reused: boolean } };
    expect(firstBody.data.reused).toBe(false);
    expect(secondBody.data).toMatchObject({ reused: true, workflowId: firstBody.data.workflowId });
    expect(secondBody.data.workflowId).toContain("project-context-demo");

    const conflicting = await app.request("/api/v1/workflows", {
      body: JSON.stringify({ ...request, input: { projectKey: "OTHER" } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(conflicting.status).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });

    const list = await app.request("/api/v1/workflows");
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ data: [{ workflowType: "encois.user-blueprint.v1" }] });

    const signal = await app.request(`/api/v1/workflows/${firstBody.data.workflowId}/signals`, {
      body: JSON.stringify({
        contractVersion: "workflow-signal.v1",
        signalName: "blueprint-approval",
        signalId: "approval-test-1",
        payload: { stepId: "summary", approved: true },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(signal.status).toBe(200);

    const pause = await app.request(`/api/v1/workflows/${firstBody.data.workflowId}/signals`, {
      body: JSON.stringify({ contractVersion: "workflow-signal.v1", signalName: "workflow-pause", signalId: "pause-test-1", payload: { reason: "Operator review" } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(pause.status).toBe(200);
    const resume = await app.request(`/api/v1/workflows/${firstBody.data.workflowId}/signals`, {
      body: JSON.stringify({ contractVersion: "workflow-signal.v1", signalName: "workflow-resume", signalId: "resume-test-1", payload: {} }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(resume.status).toBe(200);

    const cancel = await app.request(`/api/v1/workflows/${firstBody.data.workflowId}/cancel`, {
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({ data: { accepted: true } });

    const invalidSignal = await app.request(`/api/v1/workflows/${firstBody.data.workflowId}/signals`, {
      body: JSON.stringify({
        contractVersion: "workflow-signal.v1",
        signalName: "blueprint-approval",
        signalId: "approval-test-2",
        payload: { stepId: "summary" },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalidSignal.status).toBe(400);
  });

  it("rejects Signals for a terminal workflow", async () => {
    let signalCalled = false;
    const terminalProjection: WorkflowExecutionProjection = {
      workflowId: "workflow:org-1:encois.user-blueprint.v1:terminal",
      workflowType: "encois.user-blueprint.v1",
      namespace: "default",
      taskQueue: "test",
      status: "completed",
      organizationId: "org-1",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:01:00.000Z",
    };
    const workflowClient: WorkflowClient = {
      start: async () => terminalProjection,
      get: async () => terminalProjection,
      list: async () => [terminalProjection],
      signal: async () => {
        signalCalled = true;
      },
      signalCoordinator: async () => undefined,
      update: async () => undefined,
      cancel: async () => undefined,
    };
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["team-engineering"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
      workflowClient,
    });

    const response = await app.request(`/api/v1/workflows/${terminalProjection.workflowId}/signals`, {
      body: JSON.stringify({
        contractVersion: "workflow-signal.v1",
        signalName: "blueprint-approval",
        signalId: "approval-terminal-1",
        payload: { stepId: "release-summary", approved: true },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(signalCalled).toBe(false);
  });

  it("accepts a scoped context Update for an active workflow", async () => {
    let updatedRequest: unknown;
    const projection: WorkflowExecutionProjection = {
      workflowId: "workflow:org-1:encois.user-blueprint.v1:update-test",
      workflowType: "encois.user-blueprint.v1",
      namespace: "default",
      taskQueue: "test",
      status: "running",
      organizationId: "org-1",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:01:00.000Z",
    };
    const workflowClient: WorkflowClient = {
      start: async () => projection,
      get: async () => projection,
      list: async () => [projection],
      signal: async () => undefined,
      signalCoordinator: async () => undefined,
      update: async (_workflowId, _organizationId, _namespace, request) => {
        updatedRequest = request;
      },
      cancel: async () => undefined,
    };
    const app = createApp({
      authenticate: async () => ({
        principal: { actorId: "user-1", organizationId: "org-1", scope: ["team-engineering"], permissions: ["workflows:manage"] },
        status: "authenticated" as const,
      }),
      config: testConfig,
      workflowClient,
    });

    const response = await app.request(`/api/v1/workflows/${projection.workflowId}/updates`, {
      body: JSON.stringify({
        contractVersion: "workflow-update.v1",
        updateName: "blueprint-context",
        updateId: "context-update-1",
        payload: { businessInput: { releaseKey: "aug-30" }, reason: "Release was added to Jira." },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { accepted: true, updateId: "context-update-1" } });
    expect(updatedRequest).toMatchObject({ updateName: "blueprint-context", updateId: "context-update-1" });
  });
});
