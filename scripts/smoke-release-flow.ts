import { createApp } from "../apps/api-gateway/src/app.js";
import { loadConfig } from "../apps/api-gateway/src/config.js";

const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "encois";
const timeoutMs = Number(process.env.ENCOIS_SMOKE_TIMEOUT_MS ?? 30_000);
const workflowKey = process.env.ENCOIS_SMOKE_WORKFLOW_KEY ?? "smoke-project-context";
const traceId = process.env.ENCOIS_SMOKE_TRACE_ID ?? "0123456789abcdef0123456789abcdef";

const config = loadConfig({
  ...process.env,
  TEMPORAL_ADDRESS: temporalAddress,
  TEMPORAL_NAMESPACE: namespace,
  TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? "encois-agent-runtime",
});

const app = createApp({
  config,
  authenticate: async () => ({
    status: "authenticated" as const,
    principal: {
      actorId: "smoke-user",
      organizationId: "smoke-org",
      scope: ["team-smoke"],
      permissions: ["workflows:read", "workflows:run"],
    },
  }),
});

const startResponse = await app.request("/api/v1/workflows", {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    workflowType: "encois.dynamic.v1",
    key: workflowKey,
    input: { projectKey: "checkout" },
    blueprint: {
      contractVersion: "workflow-blueprint.v1",
      blueprintId: "project-context",
      version: "1.0.0",
      name: "Project context",
      workflowType: "encois.dynamic.v1",
      purpose: "Collect project context.",
      enabled: true,
      allowedTools: ["jira.project_tasks"],
      steps: [
        { id: "source", kind: "tool", tool: "jira.project_tasks" },
        { id: "summary", kind: "agent", agentDefinition: "context.synthesizer@1", dependsOn: ["source"] },
      ],
    },
  }),
});

if (startResponse.headers.get("x-trace-id") !== traceId) {
  throw new Error("workflow start did not preserve the smoke trace ID");
}

if (startResponse.status !== 202 && startResponse.status !== 200) {
  throw new Error(`workflow start failed with HTTP ${startResponse.status}: ${await startResponse.text()}`);
}

const started = (await startResponse.json()) as { data?: { workflowId?: string; reused?: boolean } };
const workflowId = started.data?.workflowId;
if (!workflowId) throw new Error("workflow start response did not include workflowId");

const replayResponse = await app.request("/api/v1/workflows", {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    workflowType: "encois.dynamic.v1",
    key: workflowKey,
    input: { projectKey: "checkout" },
    blueprint: {
      contractVersion: "workflow-blueprint.v1",
      blueprintId: "project-context",
      version: "1.0.0",
      name: "Project context",
      workflowType: "encois.dynamic.v1",
      purpose: "Collect project context.",
      enabled: true,
      allowedTools: ["jira.project_tasks"],
      steps: [
        { id: "source", kind: "tool", tool: "jira.project_tasks" },
        { id: "summary", kind: "agent", agentDefinition: "context.synthesizer@1", dependsOn: ["source"] },
      ],
    },
  }),
});
if (replayResponse.status !== 200) {
  throw new Error(`identical workflow replay failed with HTTP ${replayResponse.status}: ${await replayResponse.text()}`);
}

const conflictResponse = await app.request("/api/v1/workflows", {
  method: "POST",
  headers: { "content-type": "application/json", "x-trace-id": traceId },
  body: JSON.stringify({
    workflowType: "encois.dynamic.v1",
    key: workflowKey,
    input: { projectKey: "other" },
    blueprint: {
      contractVersion: "workflow-blueprint.v1",
      blueprintId: "project-context",
      version: "1.0.0",
      name: "Project context",
      workflowType: "encois.dynamic.v1",
      purpose: "Collect project context.",
      enabled: true,
      allowedTools: ["jira.project_tasks"],
      steps: [
        { id: "source", kind: "tool", tool: "jira.project_tasks" },
        { id: "summary", kind: "agent", agentDefinition: "context.synthesizer@1", dependsOn: ["source"] },
      ],
    },
  }),
});
if (conflictResponse.status !== 409) {
  throw new Error(`conflicting workflow replay was not rejected: HTTP ${conflictResponse.status}: ${await conflictResponse.text()}`);
}

const deadline = Date.now() + timeoutMs;
let latestStatus = "unknown";
while (Date.now() < deadline) {
  const response = await app.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
  if (response.status !== 200) {
    throw new Error(`workflow read failed with HTTP ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { data?: { status?: string; runId?: string } };
  latestStatus = body.data?.status ?? "unknown";
  if (latestStatus === "completed" || latestStatus === "failed" || latestStatus === "cancelled") {
    console.log(JSON.stringify({ event: "blueprint_smoke.completed", traceId, workflowId, ...body.data }));
    if (latestStatus !== "completed") process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (latestStatus !== "completed" && process.exitCode === undefined) {
  throw new Error(`workflow did not complete within ${timeoutMs}ms; latest status: ${latestStatus}`);
}
