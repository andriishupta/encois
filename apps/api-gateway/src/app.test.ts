import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";

const testConfig: AppConfig = {
  bodyLimitBytes: 1_048_576,
  corsCredentials: false,
  corsOrigins: ["http://localhost:5173"],
  host: "127.0.0.1",
  nodeEnv: "test",
  port: 8787,
  requestTimeoutMs: 10_000,
  temporalNamespace: "default",
  temporalTaskQueue: "test",
};

describe("API Gateway", () => {
  it("exposes public liveness and readiness endpoints", async () => {
    const app = createApp({ config: testConfig });

    expect((await app.request("/health/live")).status).toBe(200);
    expect((await app.request("/health/ready")).status).toBe(200);
  });

  it("fails closed when AOS is not configured", async () => {
    const app = createApp({ config: testConfig });
    const response = await app.request("/api/v1/integrations");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTHENTICATION_UNAVAILABLE" },
    });
  });

  it("fails closed when persistence is not configured", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["engineering"],
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

  it("starts and reads a workflow through the local Temporal blueprint", async () => {
    const app = createApp({
      authenticate: async () => ({
        principal: {
          actorId: "user-1",
          organizationId: "org-1",
          scope: ["engineering"],
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
            steps: [],
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
  });
});
