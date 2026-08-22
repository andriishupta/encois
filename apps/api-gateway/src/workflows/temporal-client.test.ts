import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { createWorkflowClient } from "./temporal-client.js";
import type { WorkflowStartCommand } from "./types.js";

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
	workflowMode: "memory",
	temporalNamespace: "default",
	temporalTaskQueue: "test",
};

const command: WorkflowStartCommand = {
	workflowType: "encois.user-blueprint.v1",
	workflowId: "workflow:org-1:encois.user-blueprint.v1:cancel-test",
	taskQueue: "test",
	requestHash: "request-hash",
	input: {
		contractVersion: "workflow-blueprint.v1",
		actorId: "user-1",
		organizationId: "org-1",
		requestId: "request-1",
		workflowId: "workflow:org-1:encois.user-blueprint.v1:cancel-test",
		policyVersion: "policy-read-only-fixture-v1",
		capability: "test-capability",
		scope: { ids: ["project:checkout"] },
		businessInput: {},
		payload: {},
	},
};

describe("Temporal workflow client cancellation", () => {
	it("rejects a workflow start whose id belongs to another organization", async () => {
		const client = createWorkflowClient(config);
		const crossOrganizationCommand: WorkflowStartCommand = {
			...command,
			workflowId: "workflow:org-2:encois.user-blueprint.v1:cross-organization",
			input: {
				...command.input,
				workflowId: "workflow:org-2:encois.user-blueprint.v1:cross-organization",
			},
		};

		await expect(client.start(crossOrganizationCommand, "default")).rejects.toThrow(
			"workflow id is outside the organization scope",
		);
	});

	it("cancels an active tenant workflow and safely replays cancellation", async () => {
		const client = createWorkflowClient(config);
		await client.start(command, "default");

		await client.cancel(command.workflowId, "org-1", "default");
		await client.cancel(command.workflowId, "org-1", "default");

		expect((await client.get(command.workflowId, "org-1", "default"))?.status).toBe("cancelled");
	});

	it("does not allow cancellation across organization scope", async () => {
		const client = createWorkflowClient(config);
		await client.start(command, "default");

		await expect(client.cancel(command.workflowId, "org-2", "default")).rejects.toThrow("workflow not found");
		expect((await client.get(command.workflowId, "org-1", "default"))?.status).toBe("queued");
	});

	it("fails closed instead of creating an in-memory client in production", async () => {
		expect(() => createWorkflowClient({ ...config, nodeEnv: "production", workflowMode: "temporal" })).toThrow(
			"TEMPORAL_ADDRESS is required",
		);
	});
});
