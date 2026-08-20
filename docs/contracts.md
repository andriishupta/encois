# Encois Contracts and Cross-Language Boundaries

**Status:** proposed generic protocol; source package not created yet

This document defines the data contracts between the TypeScript control plane,
Go Agent Runtime, private Agent Gateway, React SPA, and integrations. The
contracts are generic: a company-specific workflow is represented by a
validated Workflow Blueprint, not by a new platform-level DTO or Go workflow
type.

The repository does not yet contain `packages/contracts`. Current TypeScript
and Go DTOs are temporary local definitions used by the scaffold. Create the
package before adding more cross-language workflows or provider-specific
payloads.

The tool names in examples are protocol examples, not a promise that those
providers are already connected. The current Agent Gateway fixture catalog is
`jira.release_tasks` and `github.release_activity`; these should later be
replaced or versioned behind MCP-shaped manifests without changing the generic
Workflow Blueprint contract.

## Contract ownership

| Boundary | Source of truth | Generated consumers |
|---|---|---|
| Browser and public HTTP API | OpenAPI document | React client and TypeScript API validators/types |
| Workflow start, Signals, Updates, and results | Versioned JSON Schema | TypeScript Gateway API and Go Runtime |
| Workflow Blueprint | Versioned JSON Schema | Coordinator, Creator, Gateway API, Go Runtime, UI builder |
| Agent Gateway tool catalog and invocation | MCP-shaped JSON Schema plus Encois execution envelope | Go Runtime, Agent Gateway, integration adapters |
| Integration manifests and evidence events | Versioned JSON Schema | registry, adapters, graph/memory pipeline |
| Control-plane persistence | SQL migrations owned by Gateway API | Gateway API only |

OpenAPI describes the public application API. JSON Schema describes the
cross-language objects that must be validated independently by TypeScript and
Go. MCP supplies the industry-standard shape for tool discovery and
invocation; it is not used as the durable workflow contract.

## Planned repository layout

```text
packages/contracts/
  openapi.yaml
  schemas/
    workflow/
      start-request.v1.json
      blueprint.v1.json
      signal.v1.json
      result.v1.json
    agent-gateway/
      tool-manifest.v1.json
      tool-invocation.v1.json
      tool-result.v1.json
      execution-context.v1.json
    integrations/
      manifest.v1.json
      evidence-event.v1.json
  generated/
    typescript/

apps/agent-runtime/internal/contracts/generated/
apps/agent-gateway/internal/contracts/generated/
```

The schemas are edited as the source. Generated TypeScript and Go files are
build artifacts or checked-in outputs according to the repository's generation
policy; neither language becomes the schema owner.

## Generic workflow model

The platform has one generic execution contract. A company-specific scenario
is data:

```text
Workflow Start Request
  -> immutable Workflow Blueprint snapshot
  -> generic Temporal Workflow: encois.user-blueprint.v1
  -> typed steps: agent, tool, transform, condition, wait, approval
  -> structured result and evidence references
```

The only platform-owned long-lived workflow types are the Coordinator and the
bootstrap/reconciliation workflows. A user-created or company-created
workflow uses the registered generic Temporal Workflow. `Release Investigation`
is only an example Blueprint, not a required Encois workflow type.

### Workflow start request

```json
{
  "contractVersion": "workflow-start.v1",
  "requestId": "req_123",
  "workflowId": "workflow:acme:release-readiness:checkout:aug-30",
  "organizationId": "acme",
  "actorId": "user-123",
  "scope": {
    "teamIds": ["platform"],
    "projectIds": ["checkout"]
  },
  "policyVersion": "policy-17",
  "blueprint": {
    "blueprintId": "release-readiness",
    "version": "2.1.0"
  },
  "input": {
    "releaseName": "August checkout release",
    "releaseKey": "aug-30"
  }
}
```

The Gateway API authenticates the caller, computes the effective scope, loads
the approved Blueprint, validates the input against that Blueprint's schema,
and sends an immutable Blueprint snapshot with the Temporal start request.
The Go Runtime does not query the control-plane database.

### Workflow Blueprint

```json
{
  "contractVersion": "workflow-blueprint.v1",
  "blueprintId": "release-readiness",
  "version": "2.1.0",
  "name": "Company release readiness",
  "workflowType": "encois.user-blueprint.v1",
  "inputSchema": {
    "type": "object",
    "required": ["releaseName", "releaseKey"]
  },
  "outputSchema": {
    "type": "object",
    "required": ["status", "findings"]
  },
  "requiredScopes": ["project:checkout"],
  "allowedTools": [
    "jira.search_issues",
    "github.search_pull_requests",
    "monitoring.query_errors"
  ],
  "steps": [
    {
      "id": "jira",
      "kind": "tool",
      "tool": "jira.search_issues",
      "input": { "query": "release context" }
    },
    {
      "id": "github",
      "kind": "tool",
      "tool": "github.search_pull_requests"
    },
    {
      "id": "synthesis",
      "kind": "agent",
      "agentDefinition": "context-synthesizer@1",
      "dependsOn": ["jira", "github"],
      "outputSchema": { "type": "object" }
    }
  ],
  "requiresApproval": false
}
```

The Blueprint is configuration, not executable code. The deterministic
validator must reject unknown step kinds, unknown tools, invalid dependencies,
cycles, undeclared scopes, unsafe input mappings, and unsupported versions.
The generic Temporal Workflow interprets only the validated step kinds and
calls registered Activities.

## MCP-shaped tool contract

MCP standardizes tool discovery and invocation. Each Integration Pack may
provide an MCP server or a typed API adapter mapped into the same internal tool
catalog. The catalog follows the MCP concepts:

```json
{
  "name": "jira.search_issues",
  "title": "Search Jira issues",
  "description": "Read issues visible in the authorized project scope",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "status": { "type": "string" }
    },
    "required": ["query"]
  },
  "outputSchema": {
    "type": "object",
    "required": ["items", "observedAt"]
  },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  }
}
```

The runtime adds an Encois execution envelope around the MCP-shaped call:

```json
{
  "contractVersion": "tool-invocation.v1",
  "requestId": "req_123",
  "workflowId": "workflow:acme:release-readiness:checkout:aug-30",
  "organizationId": "acme",
  "actorId": "user-123",
  "scope": { "projectIds": ["checkout"] },
  "policyVersion": "policy-17",
  "tool": "jira.search_issues",
  "arguments": { "query": "release context" }
}
```

The Agent Gateway validates the envelope and the tool schema, re-checks
current policy, resolves credentials, calls MCP or the API adapter, validates
the result, and returns minimum required structured content plus data
references. MCP annotations are hints, not authorization. The Agent Gateway
remains the final policy boundary.

## Generic agent step

An `agent` step is also generic. Its Blueprint selects an approved
`agentDefinition`, input/output schemas, model profile, tool allowlist, budget,
and retry policy. ADK runs the agent reasoning loop and adapts registered tools
into the ADK tool abstraction. Temporal owns the durable Workflow and Activity
boundaries around that execution.

An agent may call a tool, but it cannot select a new organization, widen scope,
invent a tool, or bypass the Agent Gateway. A specialist such as Jira or GitHub
is therefore a registered capability or Agent Definition, not a platform-level
Workflow type.

## Coordinator and Workflow Creator

The Coordinator is the only product-specific long-lived control loop. It
discovers available Integration Packs, tool capabilities, data freshness, and
organization needs. The Workflow Creator proposes a `WorkflowChangePlan` with
Blueprint versions:

```json
{
  "contractVersion": "workflow-change-plan.v1",
  "planId": "plan_123",
  "coordinatorId": "coord_acme_checkout",
  "organizationId": "acme",
  "changes": [
    {
      "kind": "create",
      "blueprintId": "release-readiness",
      "version": "2.1.0",
      "reason": "The project has Jira and GitHub sources but no monitoring pack"
    }
  ]
}
```

Gemini/ADK may propose the plan. Deterministic registry, permission, policy,
and compatibility checks decide whether it can be persisted or started.

## Public and internal API boundaries

The public Gateway API exposes application concepts, not raw MCP or Temporal
details:

```text
POST /v1/workflows
GET  /v1/workflows/{workflowId}
POST /v1/workflows/{workflowId}/signals
GET  /v1/workflows/{workflowId}/events
GET  /v1/tools                 # scoped catalog projection, later
GET  /v1/integrations
```

The private Agent Gateway exposes an authenticated internal tool boundary. For
the MVP it may use HTTP/JSON with MCP-shaped payloads; a full MCP JSON-RPC
transport can be added as an adapter if external MCP clients need direct
access. The public API must not forward arbitrary tool calls from a user or
model to the private gateway.

## Compatibility rules

- Every cross-language payload has a contract version.
- Additive fields are optional first; changing field meaning requires a new major version.
- Consumers reject unknown contract versions and tolerate unknown optional fields.
- Validate JSON at both sides of every trust boundary.
- Tool results must conform to their declared output schema.
- Error responses include a stable code, human-safe message, request ID, and retryability classification.
- Provider-specific fields stay inside the adapter; normalized evidence and references cross the boundary.
- Temporal payloads contain IDs, scope, Blueprint snapshots, and references, not secrets or large raw data.
- Never use model output as the source of authorization, workflow identity, or tool permissions.

## What is deliberately not shared

- Postgres/Drizzle models are owned by the Gateway API.
- Temporal Workflow implementation code is owned by the Go Runtime.
- Google ADK, Temporal SDK, provider SDKs, and MCP client objects remain implementation details.
- Secrets, OAuth tokens, raw unrestricted company data, and chain-of-thought never cross as general-purpose DTOs.

Protobuf/gRPC can be introduced later for the private boundary if service count
or throughput justifies it. It is not needed before the generic JSON Schema
and MCP-shaped contracts stabilize.
