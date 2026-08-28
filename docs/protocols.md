# Encois Generic Agent and Workflow Protocols

**Status:** proposed generic communication model  
**Decision:** use MCP-shaped tool contracts inside a generic Workflow Blueprint executed by Temporal.

## Decision summary

Encois does not need a different Temporal Workflow type for every company's
business scenario. A company-specific process is a versioned `Workflow
Blueprint` containing typed steps, dependencies, input/output schemas, tool
allowlists, scopes, budgets, retries, and approval requirements.

The platform-owned execution path is:

```text
Gateway API
  -> Workflow Start Request
  -> immutable Workflow Blueprint snapshot
  -> Temporal: encois.dynamic.v1
  -> Go Runtime interprets the validated step graph
  -> ADK runs agent steps
  -> Agent Gateway executes MCP-shaped tools or API adapters
  -> structured result, evidence references, and projection
```

`Release Investigation` is only one possible Blueprint. It is a useful demo
scenario, but it is not the Encois platform contract and should not require a
new Go workflow type for every customer. User workflows are validated
Blueprint data interpreted by the generic `encois.dynamic.v1` workflow.

### Current repository status

The Go worker now registers the generic Blueprint Workflow together with the
Coordinator and bootstrap workflows; specialized Release/Jira/GitHub Temporal
Workflow types are not registered. The Gateway accepts a validated generic
Blueprint command, the worker interprets the basic step graph, and the Agent
Gateway returns synthetic tools. The shared `packages/contracts` package now
contains TypeScript types, JSON Schema sources, and API-side Blueprint parsing.
Runtime-to-Gateway service authentication, scope propagation, read-only policy,
and a real local multi-process Temporal smoke path are wired for the fixture
slice. The current ADK loop runs inside a Temporal Activity; finer-grained
native ADK/Temporal step integration is not yet used. The available
`go.temporal.io/sdk/contrib/googleadk@v0.2.0` package is a separate, tested
candidate that requires Temporal Go SDK `v1.45.0` and a compatible ADK revision;
it is not yet a repository dependency. Canonical schema
validation is now shared by the TypeScript API, Go Runtime, and Agent Gateway;
the `tool-manifest.v1` catalog schema is also shared and checked at its Go
boundary. The Gateway directly resolves and persists approved Blueprints; the
Coordinator only reports onboarding state. Blueprint creation and optional
Workflow start remain deterministic, scoped, and idempotent. Database-backed
application and hosted verification remain pending.

## What each standard does

| Technology | Responsibility | What it is not |
|---|---|---|
| Temporal | Durable execution, waits, retries, Signals, Updates, workflow history, task delivery | Tool catalog, authorization system, company workflow editor |
| MCP | Tool/resource discovery and invocation shape with JSON-RPC and JSON Schema | Durable execution, tenant authorization, business workflow definition |
| Google ADK | Agent reasoning loop, agent composition, model/tool integration, structured agent output | Source of truth for permissions or long-running execution |
| OpenAPI | Public Gateway API contract | Internal agent protocol |
| JSON Schema | Blueprint, workflow, tool envelope, evidence, and cross-language DTO validation | A runtime or orchestrator |
| A2A | Optional future protocol for remote agent-to-agent delegation | Required communication between Encois logical agents in the MVP |
| CloudEvents | Optional future event envelope for provider/webhook/event ingress | Workflow input or tool invocation contract |

MCP is the correct standard for the tool layer because tools have a name,
description, `inputSchema`, optional `outputSchema`, and behavior annotations.
The Encois execution envelope wraps that tool call with organization, actor,
organization-unit scope, workflow, policy, and an API-issued capability. Those security fields must not be chosen
by the model.

Google ADK can consume MCP tools as agent tools or use equivalent native tool
adapters. If a specific Go ADK version does not provide the required MCP client
helper, the Agent Runtime should expose the same MCP-shaped catalog through a
small native ADK wrapper that calls the private Agent Gateway. The contract
stays stable even if the transport adapter changes.

## Protocol layers

### 1. Public application protocol

The Gateway API accepts application requests:

```text
POST /v1/workflows
GET  /v1/workflows/{workflowId}
GET  /v1/workflows/{workflowId}/events
GET  /v1/workflows/activity
POST /v1/workflows/{workflowId}/signals
POST /v1/workflows/{workflowId}/updates
POST /v1/workflows/blueprints/preview
POST /v1/workflows/blueprints/from-intent
```

Private Runtime/Coordinator boundary:

```text
POST /v1/internal/coordinator/onboarding-status
```

The public request contains a Blueprint identity/version and business input.
It does not expose Temporal credentials, provider tokens, arbitrary MCP
invocation, or internal service addresses.

An execution may provide an inline validated `blueprint`, or reference an
approved tenant registry snapshot with `blueprintId` and `blueprintVersion`.
The latter is resolved by the Gateway API inside the organization-scoped
transaction and copied into Temporal input; the Go Runtime never reads the
registry database.

Blueprint creation is a single public flow: the preview resolves a Template or
approved Blueprint, and the submit route persists the approved Blueprint and
optionally starts its generic Temporal Workflow. The Gateway checks
organization ownership, required scopes, provider bindings, and Blueprint
validity before persistence or start. The private Coordinator route only
receives onboarding status updates.

### 2. Workflow Blueprint protocol

The Blueprint is a declarative DAG. It is validated before execution and then
treated as immutable for that Workflow Execution.

Supported step kinds for the first generic interpreter:

- `tool` — call one registered read or approved write capability;
- `agent` — run one approved ADK Agent Definition with an allowlisted tool set;
- `transform` — deterministic mapping of prior structured results;
- `condition` — deterministic branch on validated data;
- `wait` — timer or external status wait;
- `approval` — pause until an authorized human Signal/Update.

The Blueprint may contain input/output schemas and references to earlier step
outputs. It may not contain executable code, arbitrary URLs, provider tokens,
model-generated permissions, or unbounded expressions.

### 3. Temporal execution protocol

The Gateway API starts the registered generic Workflow:

```text
workflowType = encois.dynamic.v1
input = execution context + immutable blueprint snapshot + validated input
```

The Go Worker interprets only known step kinds. In the current Activity-boundary
profile, each external call, model call, database operation, graph operation,
Memory Bank operation, and MCP/API call is an Activity. A future native ADK
profile keeps the same Blueprint and tool envelopes but lets the ADK loop run
in Workflow code, dispatching model turns and I/O tools through Temporal
Activities. Temporal owns retries and replay; it does not inspect or decide
the business meaning of a tool result.

The repository reserves `agent-memory.v1` and `agent-memory-result.v1` for
scoped agent-memory retrieval and evidence-linked distillation. The Go Runtime
exposes this through an Activity-side `memory.Store` boundary with a scoped
local mock and an Agent Platform Memory Bank adapter selected by `AGENT_MEMORY_MODE`.
Memory results are summaries and references, not raw provider payloads or
Workflow history.

### 4. Tool protocol

The Agent Gateway maintains an MCP-shaped tool catalog. The current fixture
catalog already returns the following metadata; a future connector registry
will persist and version the same shape for installed Integration Packs:

```text
name
description
inputSchema
outputSchema
annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint
required capabilities/scopes
```

The fixture implementation exposes Jira and GitHub read tools plus an
unavailable approval-gated email capability. It validates the requested tool
against the catalog and checks the required execution scope before invocation.
The catalog is not yet a live MCP discovery service: provider manifests,
connector grants, credential resolution, and real MCP/API adapters are still
deferred.

The runtime invokes a tool using an Encois envelope:

```text
executionContext
tool name/version
arguments
request ID, propagated trace ID, and, once known, Temporal run ID
```

The Gateway issues the short-lived capability after authenticating the user
and resolving organization-unit scope. The Runtime forwards it as an opaque
internal field; the Agent Gateway verifies its signature and exact execution
context before every data-plane operation. It is never exposed to the browser,
model prompts, provider payloads, or logs.

The Agent Gateway then:

1. authenticates the Runtime service identity;
2. validates the execution context and current policy;
3. checks the Blueprint allowlist and effective organization scope;
4. resolves a scoped connector credential;
5. calls an MCP server or typed API adapter;
6. validates, redacts, and normalizes the result;
7. returns structured content and evidence/data references.

MCP tool annotations are useful hints, but they are not trusted authorization
input. A tool marked `readOnlyHint` is still checked by the Agent Gateway.

MCP discovery is used during Integration Pack registration, onboarding, or a
controlled catalog refresh. A running Workflow executes only immutable
tool-manifest versions and the allowlist captured by its validated Blueprint.
The model must not discover an arbitrary new server or tool in the middle of
an execution.

### 5. Source ingestion protocol

Source control-plane records use the following versioned contracts:

```text
knowledge-source.v1        logical source, kind, provider, scopes, status
source-revision.v1         immutable revision, artifact/source object reference
source-ingestion.v1        Temporal execution context + revision + trigger
source-ingestion-result.v1 typed stage, status, fact count, evidence refs
```

The Gateway API owns source registration and revision metadata. The Runtime
owns the durable ingestion orchestration. The Agent Gateway owns the final
policy check and data-plane access to provider APIs, Cloud Storage, and Graph
projection. No service sends raw bytes or credentials through a Temporal
payload. Local mode uses deterministic adapters; hosted mode uses the GCP
adapters and reports provider failures as failed/degraded results.

The same revision can be triggered by `bootstrap`, `manual`, `webhook`,
`schedule`, or `reconcile`. Trigger type changes why ingestion starts, not the
provenance or scope rules. Source revisions are immutable; replacing a PDF or
reconciling changed provider data creates a new revision rather than mutating
the evidence that produced an earlier fact.

Approval Signals use the versioned `workflow-signal.v1` envelope and require a
caller-generated `signalId`. The generic Workflow deduplicates that ID before
applying an approval or denial, while authorization remains an API concern.

The first generic Update uses `workflow-update.v1` with the
`blueprint-context` update name. It carries a small `businessInput` patch into
the existing Workflow and is accepted only for an active, authorized
execution. Temporal's Update ID provides per-Workflow idempotency at the
service boundary; broader update operations and a database audit deduplication
record remain future work.

## Agent model

The Coordinator and Workflow Creator are product-level capabilities. They are
responsible for discovering available packs and proposing Blueprint changes.
They do not generate Go code or directly execute arbitrary tools.

All other agents are registered Agent Definitions. An Agent Definition
contains:

```text
agentDefinition ID and version
purpose
input/output schemas
model profile
allowed tools
required scopes
budget and timeout
retry policy
approval requirements
```

Jira specialist, GitHub specialist, and monitoring specialist are examples of
Agent Definitions or Integration Pack capabilities. They are not separate
Temporal Workflow types or one server per repository.

Remote agent-to-agent communication is not required for the MVP. If later a
customer-owned or separately deployed agent must collaborate as an independent
service, evaluate A2A for that boundary. It should still enter Encois through a
scoped capability and should not bypass Temporal or Agent Gateway policy.

## Example: company-specific release workflow

Company A may create:

```text
Blueprint: release-readiness@2.1.0
  1. jira.search_issues
  2. github.search_pull_requests       parallel
  3. monitoring.query_errors           parallel
  4. context-synthesizer@1             depends on 1, 2, 3
  5. approval                           only if risk is high
```

Company B may create a completely different Blueprint:

```text
Blueprint: customer-launch@1.0.0
  1. crm.check_customer_commitments
  2. docs.validate_public_changelog
  3. support.check_open_escalations     parallel
  4. launch-readiness-agent@2            depends on 1, 2, 3
```

Both use the same Temporal Workflow type, the same workflow start envelope,
the same ADK agent abstraction, and the same Agent Gateway tool contract.
Only the validated Blueprint, registered tools, scopes, and Agent Definitions
change.

## Boundary rule

The Gateway API does not need to call the Agent Gateway for ordinary workflow
execution. Its responsibilities are identity, organization scope, Blueprint
registry, workflow control, and projections.

The normal execution path is intentionally asymmetric:

```text
Gateway API -> Temporal Cloud -> Go Agent Runtime -> Agent Gateway -> MCP/API provider
```

This avoids duplicating orchestration and policy logic. The Agent Gateway is
not a second Workflow engine; Temporal is not a tool broker; ADK is not the
authorization layer.

## References

- [MCP tool schema and invocation](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Google ADK MCP tools](https://adk.dev/tools-custom/mcp-tools/)
- [Google ADK workflow agents](https://adk.dev/agents/workflow-agents/)
- [Temporal Workflows](https://docs.temporal.io/workflows)
- [Temporal Activities](https://docs.temporal.io/activities)
