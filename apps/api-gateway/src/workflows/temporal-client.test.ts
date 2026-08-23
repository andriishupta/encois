import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { createWorkflowClient } from "./temporal-client.js";

const config: AppConfig = {
  bodyLimitBytes: 1_048_576,
  corsCredentials: false,
  corsOrigins: [],
  host: "127.0.0.1",
  nodeEnv: "test",
  port: 8787,
  requestTimeoutMs: 10_000,
  agentGatewayPolicyVersion: "policy-read-only-fixture-v1",
  agentGatewayCapabilitySecret: "test-capability-secret",
  executionCapabilityTtlMs: 86_400_000,
  workflowMode: "temporal",
  temporalNamespace: "default",
  temporalTaskQueue: "test",
  workflowRunRetentionDays: 30,
};

describe("Temporal workflow client", () => {
  it("requires a real Temporal address", () => {
    expect(() => createWorkflowClient(config)).toThrow("TEMPORAL_ADDRESS is required");
  });

  it("constructs only the Temporal adapter when configured", () => {
    const client = createWorkflowClient({ ...config, temporalAddress: "temporal.test:7233" });
    expect(client).toBeDefined();
  });
});
