# Encois Contracts and Cross-Language Boundaries

**Status:** minimal generic protocol implemented; provider expansion pending

This document defines the data contracts between the TypeScript control plane,
Go Agent Runtime, private Agent Gateway, React SPA, and integrations. The
contracts are generic: a company-specific workflow is represented by a
validated Workflow Blueprint, not by a new platform-level DTO or Go workflow
type.

`packages/contracts` contains the TypeScript contract types, canonical JSON
Schema sources, and a small Go validator package. The TypeScript API validates
the public Blueprint, Signal, and update payloads with Ajv-2020, then applies
semantic authorization and workflow checks. Go services embed and validate the
same schema files at the Blueprint, workflow change-plan, tool request, tool
result, artifact reference, and workflow result boundaries. Generated DTOs remain optional
follow-up work; validation does not require sharing TypeScript source with Go.

## Permission contract

`packages/contracts/permissions.json` is the single source of truth for
organization capabilities. `pnpm --filter @encois/contracts generate:permissions`
generates the TypeScript `Permission` constants used by the dashboard and
Gateway, plus Go constants used by the Runtime and Agent Gateway. Each
permission declares its implied read capabilities; the backend remains the
enforcement boundary, while the dashboard uses the same keys for route guards,
navigation, and component visibility. UI checks are guidance and never replace
the API authorization check.

The tool names in examples are protocol examples, not a promise that those
providers are already connected. The current Agent Gateway fixture catalog is
`jira.project_tasks` and `github.project_activity`. Its entries now validate
against the canonical `tool-manifest.v1` schema; persisted connector grants,
live manifests, and real provider adapters remain deferred.

## Contract ownership

| Boundary | Source of truth | Generated consumers |
|---|---|---|
| Browser and public HTTP API | OpenAPI document | React client and TypeScript API validators/types |
| Workflow start, Signals, Updates, Coordinator events, and results | Versioned JSON Schema | TypeScript Gateway API and Go Runtime |
| Workflow Blueprint | Versioned JSON Schema | Coordinator, Creator, Gateway API, Go Runtime, UI builder |
| Workflow change plans | Versioned JSON Schema | Workflow Creator, Go Runtime, Gateway API approval/application boundary |
| Agent Gateway tool catalog and invocation | MCP-shaped JSON Schema plus Encois execution envelope | Go Runtime, Agent Gateway, integration adapters |
| Artifact write/reference boundary | Versioned JSON Schema plus Encois execution envelope | Go Agent Gateway and future Runtime/storage adapters |
| Knowledge Source and ingestion | Versioned JSON Schemas plus Encois execution envelope | Gateway API, Go Runtime, source adapters, Graph/Memory projection |
| Integration manifests and evidence events | Versioned JSON Schema | registry, adapters, graph/memory pipeline |
| Control-plane persistence | SQL migrations owned by Gateway API | Gateway API only |
| Temporal command receipts | Gateway-owned tenant-scoped SQL table | TypeScript Gateway API only; never sent to Go or Temporal |

OpenAPI describes the public application API. JSON Schema describes the
cross-language objects that must be validated independently by TypeScript and
Go. The API validates `workflow-update.v1` before calling Temporal; the Go
Workflow receives only the validated update payload and applies it
deterministically. MCP supplies the industry-standard shape for tool discovery
and invocation; it is not used as the durable workflow contract.

Execution correlation uses the public `requestId`, a propagated `traceId`, the
stable logical `workflowId`, and the Temporal `runId` once a concrete execution
exists. The Go Runtime obtains that `runId` from Temporal and includes it in
Activity/tool requests; correlation IDs are not trusted as authorization input.
Approval Signals also carry a caller-generated `signalId`, which the Workflow
uses for duplicate suppression.

The Gateway also persists a tenant-scoped receipt for each Signal and Update.
It claims the command before calling Temporal, records `accepted` only after
the Temporal call and audit event succeed, and may replay `in_flight` commands
after a process crash. A different payload under the same command ID is a
conflict. This database receipt is an API delivery safeguard, not a replacement
for Temporal's Update ID or the Go Workflow's Signal deduplication.

`coordinator-event.v1` is separate from a Blueprint step Signal. It carries
tenant-scoped lifecycle notifications such as plan approval, plan application,
provider changes, and workflow completion. The Coordinator receiver deduplicates
event IDs and rejects events for another organization or Coordinator. Gateway
plan approval/application now enqueue these small events transactionally in the
tenant-scoped outbox. An applied plan includes `workflowStarts` only for changes
with an explicit `start` intent. The Coordinator starts those immutable approved
Blueprint snapshots through its private Gateway Activity; applying a registry
revision without `start` does not start an execution. Pending starts remain in
Coordinator state until the idempotent start Activity succeeds. Scheduler
invocation and hosted delivery remain deployment work.

## Repository layout

```text
packages/contracts/
  go.mod
  go.sum
  schema.go
  schema_test.go
  src/index.ts
  src/scope.ts
  src/values.ts
  src/validation.ts
  src/permissions.generated.ts
  permissions.json
  permissions_generated.go
  scripts/generate-permissions.mjs
  test-contracts.mjs
  openapi.yaml
  schemas/
    workflow-blueprint.v1.json
    blueprint-workflow-result.v1.json
    workflow-signal.v1.json
    execution-context.v1.json
    tool-request.v1.json
    tool-result.v1.json
    artifact-write.v1.json
    artifact-write-result.v1.json
    graph-query.v1.json
    graph-query-result.v1.json
    agent-memory.v1.json
    agent-memory-result.v1.json
    tool-manifest.v1.json
    workflow-update.v1.json
    workflow-change-plan.v1.json
    coordinator-event.v1.json
    knowledge-source.v1.json
    source-revision.v1.json
    source-ingestion.v1.json
    source-ingestion-result.v1.json
  # canonical schemas are consumed by both TypeScript and Go
```

The schemas are edited as the source. TypeScript types currently live in
`packages/contracts/src/index.ts`, and the public TypeScript boundary uses the
runtime validators in `src/validation.ts`. The Go package in `schema.go`
embeds the same `schemas/*.json` files and uses `jsonschema-go` for runtime
validation; Go DTOs remain local to each service. Generated Go/TypeScript
types and schema-drift checks in CI are follow-up work; neither language
becomes the schema owner. `workflow-change-plan.v1` is validated before a
bootstrap proposal can leave the Go Runtime; raw model text never crosses that
boundary.

The shared values also define organization-unit types, scope-rule modes,
freshness states, workflow status reasons, artifact retention classes, and
memory redaction states. `resolveEffectiveScope` is a pure helper used by the
Gateway to expand direct membership roots; it does not read the database or
make authorization decisions from model output.

This pre-production baseline uses `v1` for all shared application contracts and
`1.0.0` for TypeScript package and OpenAPI metadata. Database migrations remain
independently numbered and are not reset or collapsed. An incompatible
application contract will receive a new version only after a stable release
requires compatibility.

Tool, graph, memory, and artifact results carry optional freshness, provenance,
retention, or redaction metadata. This keeps the data-quality and privacy
boundaries explicit even while Graph, Memory Bank, and Cloud Storage remain
deferred adapters.

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

The platform-owned workflow types include the long-lived Coordinator and
bootstrap/reconciliation workflows plus the short-lived generic
`encois.source-ingestion.v1` source/revision pipeline. A user-created or
company-created workflow uses the registered generic Temporal Workflow.
Release readiness
is only an example Blueprint, not a required Encois workflow type.

### Knowledge Source contracts

`Knowledge Source` is the logical organization-scoped origin of knowledge.
`Integration`, `uploaded_document`, `manual`, and `media` are source kinds.
`Source Revision` is immutable and carries an artifact or provider-object
reference; it does not carry raw bytes or credentials. The API owns source and
revision registration. The Runtime receives `source-ingestion.v1`, validates
the source/revision identity and scope, and returns
`source-ingestion-result.v1` with a stage, status, fact count, and evidence
references. Provider acquisition, parsing, PII filtering, normalized Graph
writes, and optional Memory distillation are Activities/adapters behind that
stable envelope.

### Workflow start request

```json
{
  "contractVersion": "workflow-start.v1",
  "requestId": "req_123",
  "workflowId": "workflow:acme:release-readiness:checkout:aug-30",
  "organizationId": "acme",
  "actorId": "user-123",
  "scope": {
    "ids": ["unit:platform", "unit:checkout"]
  },
  "policyVersion": "policy-17",
  "blueprintId": "release-readiness",
  "blueprintVersion": "2.1.0",
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
  "inputSchemaRef": "schema://release-readiness/input.v1",
  "outputSchemaRef": "schema://release-readiness/output.v1",
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
      "dependsOn": ["jira", "github"]
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
catalog. The cross-language manifest uses `tool-manifest.v1` and follows the
MCP concepts:

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
    "idempotentHint": true,
    "openWorldHint": false
  },
  "requiredScope": ["ids"],
  "available": true,
  "approvalRequired": false,
  "contractVersion": "tool-manifest.v1",
  "version": "1.0.0",
  "kind": "tool",
  "sideEffects": "read-only"
}
```

The Go Agent Gateway embeds and validates the same manifest schema before
returning its catalog. This is still an HTTP/JSON MCP-shaped catalog rather
than a full MCP JSON-RPC transport.

The runtime adds an Encois execution envelope around the MCP-shaped call:

```json
{
  "contractVersion": "tool-request.v1",
  "requestId": "req_123",
  "workflowId": "workflow:acme:release-readiness:checkout:aug-30",
  "organizationId": "acme",
  "actorId": "user-123",
  "scope": { "ids": ["unit:checkout"] },
  "policyVersion": "policy-17",
  "capability": "<API-issued internal execution capability>",
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
  "observedAt": "2026-08-20T16:00:00.000Z",
  "changes": [
    {
      "kind": "create",
      "blueprint": {
        "contractVersion": "workflow-blueprint.v1",
        "blueprintId": "release-readiness",
        "version": "2.1.0",
        "name": "Company release readiness",
        "workflowType": "encois.user-blueprint.v1",
        "purpose": "Assess release readiness from approved company sources.",
        "enabled": true,
        "steps": [
          {
            "id": "jira",
            "kind": "tool",
            "tool": "jira.project_tasks"
          }
        ]
      },
      "reason": "The project has Jira and GitHub sources but no monitoring pack"
    }
  ]
}
```

Gemini/ADK may propose the plan. Deterministic registry, permission, policy,
and compatibility checks decide whether it can be persisted or started.

`workflow-change-plan.v1` is the single lifecycle contract. `create` carries a
Blueprint, `update` and `deprecate` carry `targetBlueprintId` plus
`targetBlueprintVersion`, and `cancel` carries `targetWorkflowId`; these target
families cannot be mixed. The Gateway validates and persists the plan, applies
Blueprint lifecycle changes, and supports Temporal cancellation only for
cancel-only plans through its Temporal client. Repeated cancellation is
idempotent; persistence-backed and hosted cancellation verification remain
deployment work. A future incompatible shape will receive a new contract
version; there is no pre-production v2 compatibility layer.

An executable `create` or `update` change may include an explicit start intent:

```json
{
  "kind": "create",
  "blueprint": { "blueprintId": "release-readiness", "version": "1.0.0" },
  "start": {
    "key": "release:checkout:2026-08-30",
    "businessInput": { "releaseKey": "2026-08-30" }
  }
}
```

The intent is declarative and is validated against the nested Blueprint. It is
not a direct Temporal command and cannot start a deprecation or cancellation.
The Gateway emits it as `workflowStarts` only after the plan is applied; the
Coordinator then performs the private, policy-checked start.

## Public and internal API boundaries

The public Gateway API exposes application concepts, not raw MCP or Temporal
details. The currently implemented browser-facing routes are mounted under
`/api/v1`:

```text
GET  /api/v1/auth/me
POST /api/v1/public/waitlist
POST /api/v1/workflows
GET  /api/v1/workflows
GET  /api/v1/workflows/{workflowId}
GET  /api/v1/workflows/{workflowId}/events
GET  /api/v1/workflows/activity
POST /api/v1/workflows/{workflowId}/signals
POST /api/v1/workflows/{workflowId}/updates
GET  /api/v1/integrations
POST /api/v1/integrations/{integrationId}
POST /api/v1/workflows/plans/validate
POST /api/v1/workflows/plans
POST /api/v1/workflows/plans/{planId}/approve
POST /api/v1/workflows/plans/{planId}/apply
```

`GET /api/v1/auth/me` is the pre-membership access-resolution contract. It
returns `active` with the local user and organization when an invite has been
accepted, or `pending` when the verified Identity Platform identity has no
active Encois membership. Invalid tokens remain `401`; provider or persistence
configuration failures remain `503`. `POST /api/v1/public/waitlist` is the
unauthenticated contact form for pending/unknown visitors. It requires a
plausible work email, company name, and at least one company website or company
LinkedIn URL. It stores only that bounded contact context and never creates an
account or grants access. Work-email validation is a heuristic; mailbox
ownership verification is a later step.

The Dashboard currently consumes workflow list/detail/start and integration
list/update. Overview counters are derived from those projections. Workflow
events, activity/evidence history, provider freshness, organization hierarchy,
agent activity, graph paths, and query endpoints remain target contracts and
must not be represented as static API data in the UI.

For the generic workflow, the start request may carry an inline validated
Blueprint or reference an approved registry snapshot:

```json
{
  "workflowType": "encois.user-blueprint.v1",
  "blueprintId": "release-readiness",
  "blueprintVersion": "1.0.0",
  "key": "checkout-aug-30",
  "input": { "releaseKey": "checkout-aug-30" }
}
```

The Gateway resolves the snapshot and sends the complete Blueprint in the
versioned Temporal input. The Go Runtime does not query the registry.

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
