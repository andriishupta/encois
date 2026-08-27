import { randomUUID } from "node:crypto";
import { type CoordinatorEvent, Permission } from "@encois/contracts";
import { createDatabase } from "@encois/persistence";
import type { AosPrincipal } from "../src/middleware/aos.js";
import type { WorkflowClient } from "../src/workflows/temporal-client.js";
import type {
  WorkflowExecutionProjection,
  WorkflowUpdateRequest,
} from "../src/workflows/types.js";

const seedDatabaseUrl = process.env.DATABASE_TEST_ADMIN_URL;
if (!seedDatabaseUrl || !process.env.DATABASE_RUNTIME_URL) {
  throw new Error(
    "DATABASE_TEST_ADMIN_URL and DATABASE_RUNTIME_URL are required",
  );
}

const { client: seedClient } = createDatabase({ url: seedDatabaseUrl });
let apiDatabaseClient: typeof seedClient | undefined;
let organizationId: string | undefined;
let userId: string | undefined;

try {
  organizationId = randomUUID();
  userId = randomUUID();
  const unitId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();
  const definitionId = randomUUID();
  const workflowRunId = randomUUID();
  const workflowId = `workflow:${organizationId}:encois.dynamic.v1:receipt-concurrency`;

  await seedClient`INSERT INTO organizations (id, slug, name) VALUES (${organizationId}, ${`api-receipt-${organizationId}`}, 'API receipt verification')`;
  await seedClient`
    INSERT INTO organization_onboarding (organization_id, status, coordinator_id, coordination_mode)
    VALUES (${organizationId}, 'ready', ${`coordinator:${organizationId}`}, 'connect-only')
  `;
  await seedClient`
    INSERT INTO users (id, identity_provider, identity_subject, email)
    VALUES (${userId}, 'test', ${`subject-${userId}`}, 'receipt-test@example.invalid')
  `;
  await seedClient`
    INSERT INTO organization_units (id, organization_id, type, slug, name)
    VALUES (${unitId}, ${organizationId}, 'team', 'receipt-team', 'Receipt test team')
  `;
  await seedClient`
    INSERT INTO roles (id, organization_id, key, name, is_system)
    VALUES (${roleId}, ${organizationId}, 'receipt-test-manager', 'Receipt test manager', false)
  `;
  await seedClient`
    INSERT INTO role_permissions (role_id, permission)
    VALUES (${roleId}, ${Permission.WorkflowsRun})
  `;
  await seedClient`
    INSERT INTO organization_memberships (id, organization_id, user_id, role_id, status)
    VALUES (${membershipId}, ${organizationId}, ${userId}, ${roleId}, 'active')
  `;
  await seedClient`
    INSERT INTO membership_scopes (organization_id, membership_id, organization_unit_id, access)
    VALUES (${organizationId}, ${membershipId}, ${unitId}, 'manager')
  `;
  await seedClient`
    INSERT INTO workflow_definitions (id, organization_id, key, version, status)
    VALUES (${definitionId}, ${organizationId}, 'encois.dynamic.v1', 'v1', 'approved')
  `;
  await seedClient`
    INSERT INTO workflow_runs (id, organization_id, definition_id, actor_user_id, temporal_namespace, temporal_task_queue, temporal_workflow_id, status, scope)
    VALUES (${workflowRunId}, ${organizationId}, ${definitionId}, ${userId}, 'encois', 'encois-agent-runtime', ${workflowId}, 'waiting', ${JSON.stringify({ ids: [unitId, "receipt-team"] })}::jsonb)
  `;

  const projection: WorkflowExecutionProjection = {
    workflowId,
    workflowType: "encois.dynamic.v1",
    namespace: "encois",
    taskQueue: "encois-agent-runtime",
    status: "waiting",
    organizationId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const appliedUpdateIds = new Set<string>();
  let transportCalls = 0;
  let logicalApplications = 0;
  const workflowClient: WorkflowClient = {
    async start() {
      throw new Error("not used by receipt verification");
    },
    async get() {
      return projection;
    },
    async list() {
      return [projection];
    },
    async signal() {
      throw new Error("not used by receipt verification");
    },
    async signalCoordinator(
      _coordinatorId: string,
      _tenantId: string,
      _namespace: string,
      _event: CoordinatorEvent,
    ) {
      throw new Error("not used by receipt verification");
    },
    async update(
      _workflowId: string,
      _tenantId: string,
      _namespace: string,
      request: WorkflowUpdateRequest,
    ) {
      transportCalls += 1;
      // Hold the first transport call long enough to force a second API caller
      // to observe the in_flight receipt. Temporal Update IDs then collapse the
      // two delivery attempts into one logical update.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!appliedUpdateIds.has(request.updateId)) {
        appliedUpdateIds.add(request.updateId);
        logicalApplications += 1;
      }
    },
    async cancel() {
      throw new Error("not used by receipt verification");
    },
    async terminate() {
      throw new Error("not used by receipt verification");
    },
  };

  const principal: AosPrincipal = {
    actorId: "receipt-test-actor",
    userId,
    organizationId,
    scope: [unitId, "receipt-team"],
  };

  // Import after DATABASE_RUNTIME_URL is set so the API uses the real
  // ephemeral database instead of its database-free local fallback.
  const [{ createApp }, databaseModule] = await Promise.all([
    import("../src/app.js"),
    import("../src/database.js"),
  ]);
  apiDatabaseClient = databaseModule.databaseClient;

  const app = createApp({
    workflowClient,
    authenticate: async () => ({ principal, status: "authenticated" as const }),
  });
  const request: WorkflowUpdateRequest = {
    contractVersion: "workflow-update.v1",
    updateName: "blueprint-context",
    updateId: "concurrent-update-1",
    payload: {
      businessInput: { releaseKey: "receipt-concurrency" },
      reason: "Concurrent receipt verification",
    },
  };

  const updateUrl = `/api/v1/workflows/${encodeURIComponent(workflowId)}/updates`;
  const sendUpdate = () =>
    app.request(updateUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trace-id": "receipt-concurrency-trace",
      },
      body: JSON.stringify(request),
    });
  const responses = await Promise.all([sendUpdate(), sendUpdate()]);
  if (responses.some((response) => response.status !== 200)) {
    const responseDetails = await Promise.all(
      responses.map(
        async (response) => `${response.status}: ${await response.text()}`,
      ),
    );
    throw new Error(
      `concurrent API Updates failed: ${responseDetails.join(" | ")}`,
    );
  }

  const [receipt] = await seedClient`
    SELECT status, request_hash
    FROM workflow_command_receipts
    WHERE organization_id = ${organizationId}
      AND temporal_workflow_id = ${workflowId}
      AND command_type = 'update'
      AND command_id = ${request.updateId}
  `;
  if (
    receipt?.status !== "accepted" ||
    transportCalls !== 2 ||
    logicalApplications !== 1
  ) {
    throw new Error(
      `unexpected concurrent receipt result: ${JSON.stringify({ receipt, transportCalls, logicalApplications, appliedUpdateIds: [...appliedUpdateIds] })}`,
    );
  }

  console.log("API command receipt concurrency verification ok");
} finally {
  await apiDatabaseClient?.end({ timeout: 5 });
  if (organizationId)
    await seedClient`DELETE FROM organizations WHERE id = ${organizationId}`;
  if (userId) await seedClient`DELETE FROM users WHERE id = ${userId}`;
  await seedClient.end({ timeout: 5 });
}
