import { OrganizationOnboardingStatus } from "@encois/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { GatewayEnv } from "./aos.js";
import { onboardingReadinessMiddleware } from "./onboarding-readiness.js";

function createTestApp(
  readiness: Awaited<
    ReturnType<Parameters<typeof onboardingReadinessMiddleware>[0]>
  >,
): Hono<GatewayEnv> {
  const app = new Hono<GatewayEnv>();
  app.use("*", async (context, next) => {
    context.set("principal", {
      actorId: "actor-1",
      organizationId: "organization-1",
      scope: [],
    });
    await next();
  });
  app.use(
    "*",
    onboardingReadinessMiddleware(async () => readiness),
  );
  app.get("/api/v1/workflows", (context) => context.json({ data: "ok" }));
  app.get("/api/v1/organization", (context) =>
    context.json({ data: "onboarding" }),
  );
  return app;
}

describe("onboardingReadinessMiddleware", () => {
  it("allows product routes only when onboarding is ready", async () => {
    const response = await createTestApp({
      status: OrganizationOnboardingStatus.Ready,
    }).request("/api/v1/workflows");
    expect(response.status).toBe(200);
  });

  it("blocks product routes for incomplete onboarding", async () => {
    const response = await createTestApp({
      status: OrganizationOnboardingStatus.Pending,
    }).request("/api/v1/workflows");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ORGANIZATION_ONBOARDING_REQUIRED",
        onboardingStatus: "pending",
      },
    });
  });

  it("keeps onboarding routes available while product routes are blocked", async () => {
    const response = await createTestApp({
      status: OrganizationOnboardingStatus.Initializing,
    }).request("/api/v1/organization");
    expect(response.status).toBe(200);
  });

  it("reports a missing row as a technical readiness failure", async () => {
    const response = await createTestApp(null).request("/api/v1/workflows");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORGANIZATION_ONBOARDING_NOT_FOUND" },
    });
  });
});
