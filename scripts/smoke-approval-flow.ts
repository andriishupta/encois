import { createApp } from "../apps/api-gateway/src/app.js";
import { loadConfig } from "../apps/api-gateway/src/config.js";

const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "encois-agent-runtime";
const timeoutMs = Number(process.env.ENCOIS_SMOKE_TIMEOUT_MS ?? 30_000);
const workflowKey = process.env.ENCOIS_SMOKE_WORKFLOW_KEY ?? "approval-smoke";
const traceId = process.env.ENCOIS_SMOKE_TRACE_ID ?? "fedcba9876543210fedcba9876543210";

const config = loadConfig({
  ...process.env,
  TEMPORAL_ADDRESS: temporalAddress,
  TEMPORAL_NAMESPACE: namespace,
  TEMPORAL_TASK_QUEUE: taskQueue,
});

const app = createApp({
  config,
  authenticate: async () => ({
    status: "authenticated" as const,
    principal: {
      actorId: "approval-smoke-user",
      organizationId: "approval-smoke-org",
      scope: ["team-approval-smoke"],
      permissions: ["workflows:read", "workflows:run"],
    },
  }),
});

const startResponse = await app.request("/api/v1/workflows", {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    workflowType: "encois.user-blueprint.v1",
    key: workflowKey,
    input: {
      blueprint: {
        contractVersion: "workflow-blueprint.v1",
        blueprintId: "approval-smoke",
        version: "1.0.0",
        name: "Approval smoke",
        workflowType: "encois.user-blueprint.v1",
        purpose: "Verify that a Temporal Workflow can wait for and resume from an authorized Signal.",
        enabled: true,
        steps: [
          { id: "human-approval", kind: "approval" },
          {
            id: "after-approval",
            kind: "transform",
            dependsOn: ["human-approval"],
            input: { approved: true },
          },
        ],
      },
    },
  }),
});

if (startResponse.status !== 202) {
  throw new Error(`approval workflow start failed with HTTP ${startResponse.status}: ${await startResponse.text()}`);
}

const started = (await startResponse.json()) as { data?: { workflowId?: string } };
const workflowId = started.data?.workflowId;
if (!workflowId) throw new Error("approval workflow response did not include workflowId");

const deadline = Date.now() + timeoutMs;
let sawRunning = false;
let latestStatus = "unknown";
while (Date.now() < deadline) {
  const response = await app.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
  if (response.status !== 200) throw new Error(`approval workflow read failed with HTTP ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { data?: { status?: string } };
  latestStatus = body.data?.status ?? "unknown";
  if (latestStatus === "running" || latestStatus === "waiting") {
    sawRunning = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!sawRunning) throw new Error(`approval workflow did not reach a running state; latest status: ${latestStatus}`);

const updateResponse = await app.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/updates`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    contractVersion: "workflow-update.v1",
    updateName: "blueprint-context",
    updateId: "approval-smoke-context-1",
    payload: { businessInput: { projectKey: "context-added-after-start" }, reason: "Project context was added after the Workflow started." },
  }),
});
if (updateResponse.status !== 200) {
  throw new Error(`workflow context Update failed with HTTP ${updateResponse.status}: ${await updateResponse.text()}`);
}
const updateReplayResponse = await app.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/updates`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    contractVersion: "workflow-update.v1",
    updateName: "blueprint-context",
    updateId: "approval-smoke-context-1",
    payload: { businessInput: { projectKey: "context-added-after-start" }, reason: "Project context was added after the Workflow started." },
  }),
});
if (updateReplayResponse.status !== 200) {
  throw new Error(`workflow context Update replay failed with HTTP ${updateReplayResponse.status}: ${await updateReplayResponse.text()}`);
}

const signalResponse = await app.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/signals`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    contractVersion: "workflow-signal.v1",
    signalName: "blueprint-approval",
    signalId: "approval-smoke-1",
    payload: { stepId: "human-approval", approved: true },
  }),
});
if (signalResponse.status !== 200) {
  throw new Error(`approval Signal failed with HTTP ${signalResponse.status}: ${await signalResponse.text()}`);
}

latestStatus = "unknown";
while (Date.now() < deadline) {
  const response = await app.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
  if (response.status !== 200) throw new Error(`approval workflow read failed with HTTP ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { data?: { status?: string; runId?: string } };
  latestStatus = body.data?.status ?? "unknown";
  if (["completed", "failed", "cancelled"].includes(latestStatus)) {
    console.log(JSON.stringify({ event: "approval_smoke.completed", traceId, workflowId, ...body.data }));
    if (latestStatus !== "completed") process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (latestStatus !== "completed" && process.exitCode === undefined) {
  throw new Error(`approval workflow did not complete within ${timeoutMs}ms; latest status: ${latestStatus}`);
}
