# Encois Architecture Dictionary

**Status:** proposed implementation vocabulary

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

In the MVP, the Gateway API and the Go Agent Runtime Worker are services. The target architecture also allows a private Agent Gateway service. A Jira specialist, Activity, or repository run is not automatically a microservice.

### Worker Deployment

A deployed instance group of a Worker application. One deployment can execute many Workflow and Activity instances. Additional deployments are an operational scaling or isolation decision, not a requirement for every agent.

## Temporal terms

### Temporal Cloud

The managed Temporal service. It stores Workflow history, schedules Workflow and Activity tasks, manages timers, retries, Signals, visibility, and recovery coordination.

Temporal Cloud does not execute Encois Go code. Encois Workers connect to it and poll task queues.

### Temporal Client

A client connection used by an application to communicate with Temporal Cloud.

- The Gateway API uses a client to start, signal, query, cancel, and describe Workflows.
- The Go Agent Runtime uses a client to create a Worker and may use it for child Workflows or Signals.

### Worker

A long-running application process that connects to Temporal Cloud, polls one or more task queues, and executes registered Workflow and Activity code.

In Encois, the primary Worker is a Go application in apps/agent-runtime.

### Task Queue

A named Temporal queue from which Workers receive Workflow or Activity tasks. Examples:

~~~text
release-investigation
integration-activities
synthesis
~~~

Task queues are used to route work to compatible Worker deployments.

### Workflow

Deterministic code that describes a durable business process. A Workflow coordinates Activities, timers, Signals, child Workflows, retries, and state transitions.

Example:

~~~text
ReleaseRiskWorkflow
~~~

Workflow code must not make arbitrary network calls, call Gemini directly, or read a database directly. Those operations belong in Activities.

### Workflow Instance

One running or completed execution of a Workflow definition with a specific input and state history.

### Parent Workflow

A Workflow that coordinates a larger investigation. ReleaseRiskWorkflow is the parent for the release-risk example.

### Child Workflow

A durable Workflow started by another Workflow. Encois may use child Workflows for Jira, GitHub, and Monitoring investigations when they need independent retries, visibility, or long waits.

### Activity

A bounded, side-effecting or non-deterministic operation executed by a Worker on behalf of a Workflow.

Examples:

~~~text
ResolveReleaseActivity
CollectJiraActivity
CollectRepositoryActivity
QueryMemoryBankActivity
WriteGraphActivity
SynthesizeInsightActivity
~~~

Activities have timeouts, retry policies, idempotency rules, and optional heartbeats. An Activity is a function registered in a Worker, not a separate server.

### Signal

An external message that changes or advances a running Workflow. Signals are used for human input, approvals, provider events, release context, and capability installation.

Examples:

~~~text
release-context-provided
approval-granted
github-capability-enabled
provider-status-updated
~~~

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
release-risk:acme:release-aug-30
~~~

### Run ID

The identifier of one concrete execution of a Workflow ID. A continue-as-new operation changes the Run ID while preserving the logical Workflow.

### SignalWithStart

A Temporal operation that sends a Signal if the Workflow exists or starts the Workflow and sends the Signal if it does not. It is useful for idempotent user requests and long-lived release investigations.

### Idempotency

The property that repeating the same request does not create duplicate effects. Encois uses stable Workflow IDs, source record IDs, Activity idempotency keys, and provider-aware upserts.

## Agent terms

### Agent Definition

An approved, versioned description of an agent role. It includes purpose, input/output schemas, allowed tools, required scopes, model settings, budget, timeout, retry, and owning Integration Pack.

### Agent Run

One execution of an Agent Definition. An Agent Run is represented by Workflow/Run IDs and projections; it does not require a new container or server.

### Coordinator Agent

An agent responsible for planning or delegating a bounded investigation to approved specialist capabilities.

The coordinator cannot invent capabilities, widen organization scope, or bypass tool policy.

### Specialist Agent

An agent focused on one domain, such as Jira, GitHub, Monitoring, or Google Workspace.

A specialist is a logical role and code/configuration inside Agent Runtime. It is not one server per repository or one permanently running process.

### Agent Runtime

The Go application that hosts Temporal Workers, Workflows, Activities, ADK agents, and integration clients. It calls the private Agent Gateway for policy-checked external access. The first vertical slice may keep the gateway implementation in-process behind the same interface; it is not a reason to couple the runtime to the control-plane database.

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

### Integration Pack

A versioned product package that bundles an Integration, health checks, tool definitions, evidence mappings, and one or more approved Specialist Agent Definitions.

The pack is the preferred term for what the UI may call a Jira Agent Manager or GitHub Agent Manager. It is not a permanently running manager process.

### Tool

A narrowly scoped callable operation exposed to an agent. Tools have an input schema, output schema, side-effect declaration, required scopes, and policy.

Examples:

~~~text
search_jira_issues
read_github_pull_request
read_deployment_status
~~~

### MCP

Model Context Protocol, a protocol for exposing tools or resources to an agent client. MCP standardizes the interface; it does not decide authorization, organization scope, or business truth.

### MCP Server

A server that exposes MCP tools or resources for an integration. It may be operated by Encois, a provider, or a customer-approved third party.

### API Adapter

An Integration implementation that calls a provider's typed REST, GraphQL, or SDK API directly instead of using MCP. The Agent Gateway applies the same policy to both API adapters and MCP servers.

### Gateway API

The public application API for people, the React SPA, and future public MCP clients. It authenticates callers, computes organization scope, exposes application capabilities, and starts or controls Temporal Workflows. It does not execute provider/model calls or act as an unrestricted provider proxy.

### Agent Gateway

The private east-west policy and tool broker between the Go Agent Runtime and external systems. It validates the registered tool, actor, organization scope, agent policy, connector grant, host, method, timeout, and payload before routing to an API Adapter or MCP Server. It resolves short-lived credentials and performs the final policy check immediately before the external call. It is a separate internal service in the target architecture and may be in-process for the first slice; it is never browser-facing.

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

The canonical description of Temporal payloads, private Agent Gateway requests/results, integration manifests, and evidence events. It allows TypeScript and Go types to be generated from the same source.

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

### Gemini

The model used for planning, evidence synthesis, classification, and structured explanations. Gemini output is untrusted input and must be schema-validated; it never makes authorization decisions.

### Agent Engine Session

A managed conversation/session context for an agent interaction. It is useful for conversational continuity but is not the canonical store for company facts.

### Memory Bank

Managed semantic memory for agent-specific context, prior conclusions, recurring patterns, and important outcomes.

Memory Bank is scoped by organization and, where needed, agent, team, or user. It is not the canonical source for permissions, entities, relationships, or evidence.

## Data and intelligence terms

### Raw Snapshot

An immutable or retention-controlled copy of provider data as observed at a point in time. Raw snapshots are stored in Cloud Storage and referenced by ID or URI.

### Normalized Fact

A provider-independent representation of an observed fact, such as “ticket PAYMENTS-142 is blocked” or “deployment deploy-555 affected checkout-api.”

### Source Fact

A Normalized Fact with source system, source record ID, timestamps, transformation version, scope, and provenance.

### Evidence

A source-backed item that supports an insight. Evidence should identify the source record, observation time, freshness, and raw artifact reference where applicable.

### Spanner Graph

The shared company context layer. It stores organization entities, graph relationships, normalized facts, provenance, temporal validity, and relational read projections.

Example relationships:

~~~text
Ticket BLOCKS Release
Commit IMPLEMENTS Ticket
Deployment AFFECTS Service
Person RESPONSIBLE_FOR Ticket
~~~

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
