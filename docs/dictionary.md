# Encois Architecture Dictionary

This is the canonical vocabulary for the product and runtime.

This document is the naming reference for the architecture and runtime flows. The terms below should not be used interchangeably.

## Product and deployment terms

### Encois

The organizational context-intelligence product. It reads company signals, correlates facts, runs bounded investigations, and presents evidence-backed insights.

### Control Plane

The application-facing management layer. In Encois it is primarily the Gateway API, organization and permission model, Agent Registry, Integration Pack registry, workflow control, audit projections, and UI projections.

If the control plane uses Postgres and Drizzle, the Gateway API owns that database and its migrations. The Go Runtime does not query it.

### Agent Plane

A working product term for the execution side of a company or tenant: Agent Runtime Workers, approved Agent Definitions, enabled Integration Packs, tool policies, agent memory configuration, and related observability.

Agent Plane is not one process and is not the name of the Go binary. For the MVP, use Agent Runtime for the deployable Go application. Use dedicated Agent Plane only when describing a customer-specific deployment boundary.

### Microservice

An independently deployable process or container with its own lifecycle, configuration, scaling, and operational boundary.

The current deployable application services are the Dashboard, Gateway API,
Go Agent Runtime, and private Agent Gateway. A Jira specialist, Activity, or
repository Run is not automatically a microservice.

### Worker Deployment

A deployed instance group of a Worker application. One deployment can execute many Workflow and Activity instances. Additional deployments are an operational scaling or isolation decision, not a requirement for every agent.

## Temporal terms

### Temporal Cloud

The managed Temporal service. It stores Workflow history, schedules Workflow and Activity tasks, manages timers, retries, Signals, visibility, and recovery coordination.

Temporal Cloud does not execute Encois Go code. Encois Workers connect to it and poll task queues.

### Temporal Client

A client connection used by an application to communicate with Temporal Cloud.

- The Gateway API uses a client to start, signal, query, describe, and cancel
  Workflows. The permission-gated public cancel route delegates to this client
  and persists its audit/projection changes.
- The Go Agent Runtime uses a client to create a Worker and may use it for child Workflows or Signals.

### Temporal Namespace

An operational/deployment partition for Temporal Workflows and task queues. It
can provide dedicated customer isolation, but it is not the primary tenant
authorization boundary; Gateway checks, organization-scoped IDs, and Agent
Gateway policy remain mandatory.

### Worker

A long-running application process that connects to Temporal Cloud, polls one or more task queues, and executes registered Workflow and Activity code.

In Encois, the primary Worker is a Go application in apps/agent-runtime.

### Task Queue

A named Temporal queue from which Workers receive Workflow or Activity tasks. Examples:

~~~text
encois-agent-runtime
~~~

Task queues are used to route work to compatible Worker deployments.

### Workflow

Deterministic code that describes a durable business process. A Workflow coordinates Activities, timers, Signals, child Workflows, retries, and state transitions.

The MVP's generic executable Workflow is:

~~~text
encois.dynamic.v1
~~~

Workflow code must not make arbitrary network calls, call Gemini directly, or read a database directly. Those operations belong in Activities.

### Workflow Instance

One running or completed execution of a Workflow definition with a specific input and state history.

### Parent Workflow

A Workflow that coordinates a larger execution or investigation. In the MVP,
the generic Blueprint Workflow coordinates company-specific steps; release
readiness is only one example Blueprint.

### Child Workflow

A durable Workflow started by another Workflow. The MVP does not create
provider-specific child Workflow types for Jira, GitHub, or Monitoring. A
Blueprint uses Activities or agent steps; child Workflows remain an option for
future platform-owned sub-executions that need independent retries, visibility,
or long waits.

### Activity

A bounded, side-effecting or non-deterministic operation executed by a Worker on behalf of a Workflow.

Examples:

~~~text
ExecuteBlueprintToolActivity
RunBlueprintAgentActivity
QueryMemoryBankActivity
WriteGraphActivity
PersistWorkflowResultActivity
~~~

Activities have timeouts, retry policies, idempotency rules, and optional heartbeats. An Activity is a function registered in a Worker, not a separate server.

### Signal

An external message that changes or advances a running Workflow. Signals are used for human input, approvals, provider events, release context, and capability installation.

Current generic Workflow Signals include `blueprint-approval`,
`workflow-pause`, and `workflow-resume`. The Coordinator also receives its
separate `coordinator-event.v1` lifecycle envelope through a Temporal Signal.

### Query

A read-only request for the current Workflow state. A Query must not mutate the Workflow.

### Timer

A durable Workflow wait that can last seconds, days, or weeks without keeping a Worker process busy.

### Continue-as-new

A Temporal operation that starts a new Run ID for the same logical Workflow ID with compacted state. It is used to keep long Workflow histories bounded.

### Workflow ID

The stable business identifier for a logical Workflow. It is used for deduplication and lookup.

Example:

~~~text
workflow:acme:release-readiness:checkout:aug-30
~~~

### Run ID

The identifier of one concrete execution of a Workflow ID. A continue-as-new operation changes the Run ID while preserving the logical Workflow.

### SignalWithStart

A Temporal operation that sends a Signal if the Workflow exists or starts the Workflow and sends the Signal if it does not. It is useful for idempotent Blueprint executions and long-lived Coordinator workflows.

### Idempotency

The property that repeating the same request does not create duplicate effects. Encois uses stable Workflow IDs, source record IDs, Activity idempotency keys, and provider-aware upserts.

### Workflow Command Receipt

A tenant-scoped Gateway API record for a Signal or Update sent to Temporal. It
is claimed before delivery and moves through `in_flight`, `accepted`, or
`failed`. An `in_flight` receipt may be replayed after an API crash; a changed
payload under the same command ID is rejected. It protects API delivery and
audit consistency, while Temporal Update IDs and Workflow Signal IDs protect
the execution boundary.

## Agent terms

### Agent Definition

An approved, versioned description of an agent role. It includes purpose, input/output schemas, allowed tools, required scopes, model settings, budget, timeout, retry, and owning Integration Pack.

### Agent Run

One execution of an Agent Definition. An Agent Run is represented by Workflow/Run IDs and projections; it does not require a new container or server.

### Coordinator Agent

An agent responsible for coordinating or delegating a bounded investigation to approved specialist capabilities.

The coordinator cannot invent capabilities, widen organization scope, or bypass tool policy.

### Coordinator Workflow

The long-lived Temporal Workflow that owns one organization coordination loop.
It coordinates onboarding, bootstrap, and workflow readiness,
reconciliation, and waits for Signals or schedules. It is logically persistent
but uses Continue-As-New to keep each concrete Run History bounded.

### Coordinator Event

A versioned `coordinator-event.v1` lifecycle envelope delivered to a
Coordinator Workflow. It represents events such as provider changes, source
readiness, or workflow completion. It is
separate from a `workflow-signal.v1`, which belongs to a step inside one
generic Blueprint Workflow. Event IDs are deduplicated by the Coordinator, and
organization/Coordinator identity is checked before state changes.

### Onboarding

The required, server-enforced setup state in which an organization connects
approved Sources or uploads documents, establishes initial scope, and builds
enough context for the dashboard. Encois uses organization terminology; this
is not a project lifecycle. An organization is not dashboard-ready until its
persisted onboarding status is `ready`.

Canonical onboarding statuses:

- `pending` — the organization exists, but required setup or source context is
  incomplete; only onboarding surfaces are available.
- `initializing` — Temporal accepted the Coordinator start and bootstrap is in
  progress; ordinary product surfaces remain blocked.
- `ready` — the Coordinator completed the required initial reconciliation and
  the Gateway persisted readiness; normal product permissions apply.
- `failed` — bootstrap or required reconciliation failed or was deferred; an
  authorized administrator may explicitly retry.

A missing `organization_onboarding` row is not `pending` and is not a user
onboarding state. It is a control-plane data or migration error. The API must
return `ORGANIZATION_ONBOARDING_NOT_FOUND`, and neither the API nor dashboard
may fabricate a fallback state. See the [architecture and onboarding policy](architecture.md#canonical-lifecycle).

### Workflow Blueprint

A versioned, typed configuration describing an approved workflow intent:
trigger, step graph, input/output schemas, tool and Agent Definition references,
required scopes, schedule, budget, retry, and approval requirements. A
Blueprint is not executable Go code; it is interpreted by the registered
`encois.dynamic.v1` Workflow.

### Workflow Step

A typed node in a Workflow Blueprint. The first generic interpreter supports
`tool`, `agent`, `transform`, `condition`, `wait`, and `approval` steps. A step
has an ID, optional dependencies, validated input mapping, output schema, and
bounded execution policy.

### Workflow Creator

The Gateway application service that resolves a selected Template or approved
Blueprint against scope, Integration capabilities, and user configuration. It
previews the resolved Blueprint, persists it directly, and can enqueue the
first Run through the Coordinator outbox. It does not require a separate
deployable service or model call.

### Specialist Agent

An agent focused on one domain, such as Jira, GitHub, Monitoring, or Google Workspace.

A specialist is a logical role and code/configuration inside Agent Runtime. It is not one server per repository or one permanently running process.

### Agent Runtime

The Go application that hosts Temporal Workers, Workflows, Activities, ADK
agents, and integration clients. It calls the separately deployable private
Agent Gateway for policy-checked external access and never connects directly
to the control-plane database.

Typical location:

~~~text
apps/agent-runtime/
~~~

### Agent Registry

The control-plane registry of approved Agent Definitions, versions, capabilities, allowed tools, scopes, status, and owning Integration Packs. It describes what may run; it does not list running processes.

### Capability

A named ability required by a Workflow or agent.

Examples:

~~~text
jira.issues.read
github.issues.read
monitoring.deployments.read
~~~

If a required capability is unavailable, a Workflow should enter WAITING_FOR_CAPABILITY and produce an actionable UI state instead of an opaque model error.

## Integration and tool terms

### Integration

The technical connection to an external system. It handles authentication, pagination, rate limits, provider payloads, normalization, and source-specific errors.

Examples:

~~~text
Jira Integration
GitHub Integration
Monitoring Integration
~~~

### Source

An organization-unit-scoped logical origin of company knowledge. A provider
Source references an organization-level Integration; other kinds include
uploaded documents, manual input, and media. A Source carries read/visibility
scope and lifecycle state, but never stores provider credentials. The API and
generated wire contracts retain `KnowledgeSource` names for compatibility.

### Source Revision

An immutable version of a Source. It points to raw data through an
artifact reference or a provider object ID and preserves observed time,
checksum, content type, and later provenance locators. Replacing an uploaded
file or reconciling changed provider data creates a new revision.

### Source Ingestion Workflow

The platform-owned `encois.source-ingestion.v1` Temporal Workflow that runs
acquisition, parsing, scope validation, redaction, fact/entity/relationship
extraction, provenance creation, Graph projection, and optional Memory
distillation. It is not a user-created Blueprint and does not create Go code
dynamically.

### Knowledge Ingestion

The common pipeline after source-specific acquisition. Jira, GitHub, PDF,
Markdown, manual notes, and future media sources converge on the same typed
evidence/provenance model. The current slice has deterministic local
acquisition/parsing plus selectable Cloud Storage, Spanner, and Memory Bank
adapters; OCR, transcription, and live provider acquisition remain separate
extensions.

### Integration Pack

A versioned product package that bundles an Integration, health checks, tool definitions, evidence mappings, and one or more approved Specialist Agent Definitions.

The pack is the preferred term for what the UI may call a Jira Agent Manager or GitHub Agent Manager. It is not a permanently running manager process.

### Tool

A narrowly scoped callable operation exposed to an agent or Blueprint step.
Tools have an input schema, output schema, side-effect annotations, required
scopes, and policy. The catalog follows the MCP tool shape even when the
implementation is a typed API adapter.

Examples:

~~~text
search_jira_issues
read_github_pull_request
read_deployment_status
~~~

### MCP

Model Context Protocol, an open protocol for exposing tools, resources, and
prompts to an agent client. For Encois, MCP is the standard tool discovery and
invocation shape. It does not decide authorization, organization scope,
durable execution, or business truth.

### Tool Manifest

The MCP-shaped description of a registered tool: name, description,
`inputSchema`, optional `outputSchema`, behavior annotations, and Encois
capability metadata. Tool annotations are hints and never replace the Agent
Gateway policy check.

### Tool Invocation

A request to execute one registered tool. It contains the tool name and
arguments plus an Encois Execution Context with workflow, actor, organization,
scope, request ID, and policy version.

### MCP Server

A server that exposes MCP tools or resources for an integration. It may be operated by Encois, a provider, or a customer-approved third party.

### API Adapter

An Integration implementation that calls a provider's typed REST, GraphQL, or SDK API directly instead of using MCP. The Agent Gateway applies the same policy to both API adapters and MCP servers.

### Gateway API

The public application API for people, the React SPA, and future public MCP clients. It authenticates callers, computes organization scope, exposes application capabilities, and starts or controls Temporal Workflows. It does not execute provider/model calls or act as an unrestricted provider proxy.

### Agent Gateway

The private east-west Go service and policy/tool broker between the Agent
Runtime and external systems. It validates the registered tool, actor,
organization scope, agent policy, connector grant, host, method, timeout, and
payload before routing to an API Adapter or MCP Server. It resolves short-lived
credentials and performs the final policy check immediately before the
external call. It is never browser-facing.

### Read Tool

A tool that only observes external state. Read tools are the default for the MVP.

### Write Tool

A tool that changes external state. Write tools require explicit approval, authorization, audit logging, idempotency, and a rollback or recovery story.

### Browser Worker

An isolated, last-resort execution component for systems without a usable API. It must use an allowlisted domain, short-lived credentials, bounded actions, and read-only policy in the MVP.

## Contracts and communication terms

### Contract

A versioned schema exchanged across a process or trust boundary. Contracts describe intent-level data and references, not SDK objects, database models, secrets, or raw unrestricted provider payloads.

### OpenAPI

The canonical description of the public Gateway API: routes, request/response DTOs, auth requirements, errors, pagination, and generated client types.

### JSON Schema

The canonical description of Workflow Blueprints, Temporal payloads, private
Agent Gateway requests/results, integration manifests, and evidence events. It
allows TypeScript and Go types to be generated from the same source.

### Execution Context

The small, versioned authorization context passed with a Workflow or tool request. It includes request ID, organization, actor, effective scope, integration grant, and policy version. It does not include secrets or raw source data.

### Data Reference

A stable identifier for data stored outside a Workflow payload, such as a Cloud Storage raw snapshot, Spanner Graph fact, or evidence batch. References keep Temporal history and cross-service messages small.

### Execution-Scoped Capability

A narrow, short-lived token or server-side capability that grants one explicitly listed operation for one Workflow or result within one organization. It is not a user session, service identity, provider credential, or general API key.

### Service Identity

A non-human identity used by a service, Worker, Agent Gateway, or integration. It has its own least-privilege permissions and must not inherit a human user's unrestricted access.

### Policy Decision

A deterministic allow, deny, wait, or approval-required result for a tool or workflow transition. Policy decisions are made from identity, scope, integration grants, and registered definitions; Gemini cannot make them.

## Google and model terms

### Google ADK

Google's Agent Development Kit. In Encois it provides agent construction, coordinator/specialist delegation, tool definitions, sessions, and structured agent behavior.

ADK does not provide durable execution. Temporal remains responsible for Workflow state, waiting, retries, and recovery.

The current Runtime uses ADK inside a Temporal Activity, so the whole agent
interaction is retried as one Activity. Temporal's separate Go
`contrib/googleadk` module can instead run the ADK loop in Workflow code and
turn model calls and I/O tools into durable Activities. That native profile is
a candidate, not the current Encois runtime implementation.

### Gemini

The model used for evidence synthesis, classification, and structured explanations. Gemini output is untrusted input and must be schema-validated; it never makes authorization decisions.

### Agent Engine Session

A managed conversation/session context for an agent interaction. It is useful for conversational continuity but is not the canonical store for company facts.

### Memory Bank

The current managed provider used for agent-specific semantic memory, prior
conclusions, recurring patterns, and important outcomes. It is an adapter
implementation name, not the preferred product/UI label.

Memory Bank scope uses exact provider matching. The current Encois adapter maps
organization, agent definition, and optional project/user scope; it does not yet
materialize the complete organization-unit hierarchy inside the provider. It is
not the canonical source for permissions, entities, relationships, or evidence.

## Data and intelligence terms

### Organizational Unit

A node in the organization-owned visibility tree. Units may represent a
department, team, project, service, or custom logical group and have an
optional parent.

### Effective Scope

The deterministic visibility set for an actor or agent: inherited descendants
of direct membership roots plus explicit grants, minus explicit restrictions.
Roles alone never define effective scope.

### Raw Snapshot

An immutable or retention-controlled copy of provider data as observed at a point in time. Raw snapshots are stored in Cloud Storage and referenced by ID or URI.

### Normalized Fact

A provider-independent representation of an observed fact, such as “ticket PAYMENTS-142 is blocked” or “deployment deploy-555 affected checkout-api.”

### Source Fact

A Normalized Fact with source system, source record ID, timestamps, transformation version, scope, and provenance.

### Evidence

A source-backed item that supports an insight. Evidence should identify the source record, observation time, freshness, and raw artifact reference where applicable.

### Organization Memory Graph

The product term for the shared company context layer. It stores organization
entities, graph relationships, normalized facts, provenance, temporal validity,
visibility scope, and relational read projections. The current provider
implementation is a tenant-keyed Spanner graph projection, but product docs and
UI should use Organization Memory Graph rather than the provider name.

Example relationships:

~~~text
Ticket BLOCKS Release
Commit IMPLEMENTS Ticket
Deployment AFFECTS Service
Person RESPONSIBLE_FOR Ticket
~~~

### Workflow Memory

The product term for scoped semantic memory used by a workflow or agent across
executions. It is derived from validated evidence, must retain provenance and
redaction metadata, and is never an authorization source. The current provider
implementation is Memory Bank; future implementations may use another adapter
or a customer-owned memory API.

### Freshness

Metadata that says when source data was observed and ingested, and whether it
is within the source-specific freshness budget. A stale or unknown source must
remain visible as stale or unknown in an insight.

### Memory Distillation

The controlled conversion of validated evidence into a small reusable agent
memory. It includes PII/secret filtering and evidence references; it does not
make Memory Bank a graph, workflow, or authorization store.

### Graph Projection

A UI- or query-oriented view of graph data, such as the path from a release risk to a blocked ticket, owner, deployment, and incident.

### Insight

A structured user-facing conclusion containing observed facts, model inference, recommendation, confidence, evidence, freshness, scope, and limitations.

### Insight Projection

A persisted, query-friendly representation of an Insight used by the Gateway API and React UI. It is separate from the full Temporal history and raw provider payloads.

### Execution Event

A structured record that explains what happened during a Workflow or Agent Run: trigger, delegation, Activity, tool call, wait, retry, result, or error. It is safe for observability and UI projections and must not contain chain-of-thought or secrets.

## State and policy terms

### Business Pause

A normal Workflow state in which progress requires input or an external event. It is not necessarily a failure.

Examples:

~~~text
WAITING_FOR_INPUT
WAITING_FOR_CAPABILITY
WAITING_FOR_APPROVAL
~~~

### Retryable Failure

An error such as a timeout, transient provider outage, or rate limit that may be retried by Temporal under a bounded policy.

### Terminal Failure

An error that should not be retried automatically, such as invalid input, denied scope, unsupported capability, or schema validation failure.

### Partial Result

A usable result produced from available evidence when one or more bounded sources failed. The UI must show which evidence is missing or stale.

### Scope

The effective set of organization data and actions visible to an actor or agent. It is computed from identity, membership, grants, Workflow scope, Agent Definition policy, and Integration Pack grants.

### Approval Boundary

The explicit point where a user or authorized policy must approve a sensitive or external write before an Activity can execute it.

### Provenance

Metadata explaining where a fact or insight came from, when it was observed, how it was transformed, and what evidence supports it.
