import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import {
  createWorkflowClient,
  parseTemporalResultStatus,
} from "./temporal-client.js";

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
  temporalNamespace: "encois",
  temporalTaskQueue: "test",
  workflowRunRetentionDays: 30,
};

describe("Temporal workflow client", () => {
  it("requires a real Temporal address", () => {
    expect(() => createWorkflowClient(config)).toThrow(
      "TEMPORAL_ADDRESS is required",
    );
  });

  it("constructs only the Temporal adapter when configured", () => {
    const client = createWorkflowClient({
      ...config,
      temporalAddress: "temporal.test:7233",
    });
    expect(client).toBeDefined();
  });

  it("preserves semantic terminal statuses from a completed Dynamic workflow", () => {
    expect(
      parseTemporalResultStatus({
        status: "partial",
        statusReason: "degraded_evidence",
      }),
    ).toEqual({
      status: "partial",
      statusReason: "degraded_evidence",
    });
    expect(
      parseTemporalResultStatus({
        status: "failed",
        statusReason: "provider_unavailable",
      }),
    ).toEqual({
      status: "failed",
      statusReason: "provider_unavailable",
    });
  });

  it("rejects statuses that are not valid completed workflow results", () => {
    expect(parseTemporalResultStatus({ status: "running" })).toBeUndefined();
    expect(parseTemporalResultStatus({ status: "unknown" })).toBeUndefined();
  });
});
