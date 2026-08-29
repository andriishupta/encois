# Encois contracts

This document defines the boundaries between the Dashboard, Gateway API,
Temporal, Go Agent Runtime, Agent Gateway, and control-plane persistence.
Schemas in `packages/contracts` and the OpenAPI document are authoritative;
this document explains their ownership and use.

## Contract ownership

| Boundary | Format | Owner |
| --- | --- | --- |
| Dashboard ↔ Gateway API | OpenAPI | Gateway API |
| Gateway API ↔ PostgreSQL | Drizzle schema and migrations | Gateway API |
| Gateway API ↔ Temporal | Temporal SDK payloads plus versioned JSON Schema | shared contracts |
| Runtime ↔ private Gateway | versioned JSON Schema and authenticated HTTP | shared contracts |
| Coordinator events | `coordinator-event.v1` JSON Schema | shared contracts |
| Blueprint execution | `workflow-blueprint.v1` JSON Schema | shared contracts |
| Provider tools and evidence | typed Agent Gateway contracts | Agent Gateway/shared contracts |

The Go Runtime and Agent Gateway do not import TypeScript or connect directly
to the control-plane database. Cross-language payloads use generated or
manually mirrored types validated at both boundaries.

OpenAPI describes public/private HTTP payloads. JSON Schema describes
cross-language Temporal, Blueprint, Source, memory, graph, artifact, and tool
payloads. Temporal Workflow/Signal/Update names are versioned contract values.
MCP is a tool-shape option behind Agent Gateway policy, not the application API
or the execution engine.

## Public API rules

Every public request is authenticated, organization-scoped, validated, and
authorized before data is loaded. Responses are projections, not raw Temporal,
provider, or database objects. Errors use a stable code and a request ID.

The public workflow creation contract accepts a Template or an existing
Blueprint reference, scope, name, and validated configuration. It exposes
`Preview Blueprint` and direct Blueprint creation. It does not expose internal
Coordinator IDs or raw provider credentials.

The start request is asynchronous. A successful request returns a queued Run
projection. It does not claim that Temporal is already running the Run.

Organization onboarding is a separate server-owned contract with persisted
states `pending`, `initializing`, `ready`, and `failed`. A missing onboarding
row produces `ORGANIZATION_ONBOARDING_NOT_FOUND`; it is not another state.
Only the private Coordinator callback can complete `initializing` as `ready`
or `failed`, and it must match the organization and Coordinator identity.

## Blueprint model

A Blueprint is the executable, organization-scoped configuration of a generic
Workflow. It contains:

- contract version and Blueprint identity;
- source Template or Blueprint lineage;
- resolved provider capabilities and source bindings;
- ordered or dependency-linked steps;
- typed step inputs and bounded output references;
- scope requirements and execution policy;
- immutable resolved configuration used by a Run.

The browser submits references and user configuration. The Gateway resolves
provider slots, validates capabilities and scope, and persists the resolved
snapshot. A future Blueprint revision is another immutable snapshot with an
explicit revision identity; it is not a mutable in-place edit.

## Workflow and Run contract

The product distinguishes:

```text
Template -> Blueprint -> Workflow -> Run -> Temporal execution
```

The Workflow is the named product object. The Run contains the selected
Blueprint reference, scope, business input, actor, stable Temporal Workflow
identity, timestamps, and the Gateway projection of Temporal state. Explicit
API start commands may additionally use an idempotency key. Temporal owns
execution history; the Gateway owns the user-facing projection and audit
metadata.

Current Run statuses are `queued`, `running`, `waiting`, `paused`, `partial`,
`failed`, `completed`, and `cancelled`. Unknown values are contract errors and
are not mapped to a convenient status.

The start path is:

```text
workflow-start-requested
  -> Coordinator event
  -> Coordinator Activity
  -> private Gateway start route
  -> generic Blueprint Temporal Workflow
```

The private start route accepts only an approved Blueprint registry reference,
the organization and scope, validated business input, and a stable idempotency
key. It rechecks the Blueprint, Workflow, actor, and scope before starting or
returning the existing execution.

## Coordinator event envelope

`coordinator-event.v1` contains a small bounded envelope. Its required fields
are:

- contract version;
- event ID and event type;
- organization ID;
- Coordinator ID.

Optional fields are `actorId`, `approved`, `blueprintId`,
`blueprintVersion`, `workflowId`, `key`, `businessInput`, `scope`, `reason`,
and `evidenceRefs`. The event ID is the delivery deduplication identity; the
schema does not carry a separate idempotency key or event timestamp.

Current event types:

| Event | Producer | Coordinator responsibility |
| --- | --- | --- |
| `reconcile-requested` | onboarding/control plane | reconcile workspace state |
| `integration-connected` | Integration service | add or reconcile provider capability |
| `provider-changed` | Integration service | reconcile changed/disabled provider |
| `source-ready` | Source ingestion | make new source context available |
| `workflow-start-requested` | Workflow Creator | start the approved Blueprint Run |
| `workflow-completed` | Runtime projection | update coordination context and history |

Every event is validated against the schema, checked against the current
organization and Coordinator, deduplicated by event ID, and processed with
bounded retries. `workflow-start-requested` additionally requires an approved
Blueprint reference, Workflow ID, business key, scope, and business input.
Unknown event types fail closed.

## Transactional outbox

For events that originate with a control-plane state change, the producer
updates its PostgreSQL record and inserts the outbox row in one transaction.
The row includes a lease, attempt count, next-attempt time, last error, and
delivery status.

Only the dispatcher owns the Temporal Signal adapter. It claims rows with a
lease, delivers the versioned event to the Coordinator, and retries transient
failures with backoff. Duplicate delivery is expected and must be harmless.

The outbox can later be relayed to Google Pub/Sub or Kafka without changing the
event contract. The broker is a transport; PostgreSQL remains the durable
producer record until the relay has acknowledged the message, and Temporal
remains the execution source of truth.

## Temporal contracts

Temporal Workflow types are stable contract values, including:

- the long-lived `CoordinatorWorkflow`;
- the generic Blueprint Workflow;
- Source ingestion workflows;
- bounded specialist or integration workflows where present.

Signals and Queries are versioned names. Workflow IDs are generated by the
server from organization and resource identity. Run IDs and Temporal IDs are
technical identifiers shown only in technical detail views.

Current Workflow types are `CoordinatorWorkflow`, `encois.dynamic.v1`,
`encois.source-ingestion.v1`, and `BootstrapProjectWorkflow`. The Runtime polls
one configured task queue—`encois-agent-runtime` by default—and registers these
Workflow types and their Activities in one worker deployment.

Activities must have explicit input/output types, timeouts, bounded retries,
and idempotency behavior. Activities do not use hidden database access to
reconstruct missing application state.

## Source and evidence contracts

A Source identifies a provider resource or uploaded document and includes:

- organization and visibility scope;
- Integration reference when provider-backed;
- provider/type metadata;
- ingestion policy;
- latest Source Revision and freshness information.

A Source Revision is immutable. Ingestion preserves source record IDs, observed
time, ingestion time, transformation version, and a bounded provenance link.

Evidence passed through Runtime and Gateway contracts includes the minimum
source reference needed to inspect a claim. Missing provider metadata remains
missing; consumers must not convert it into a fabricated timestamp,
confidence, or healthy state.

## Agent and tool contracts

An agent has a narrow role, typed input/output, a tool allowlist, timeout,
retry limit, budget, and organization scope. Model output is untrusted and is
validated before it becomes a persisted result or a command.

An Agent Gateway tool declares:

- purpose and side effects;
- input and output schema;
- required capability and effective scope;
- provider or data source;
- redaction and retention behavior.

Tools are read-only by default. External writes require a separate approval
boundary and are not implied by a Blueprint or an agent recommendation.

## Compatibility rules

- Version contracts when their meaning or required fields change.
- Reject invalid or unknown payloads at the receiving boundary.
- Do not add silent aliases, legacy names, or fallback state mappings.
- Keep provider-specific payloads behind adapters.
- Keep organization ID, scope, actor, correlation ID, and idempotency metadata
  through asynchronous boundaries.
- Keep schemas in `packages/contracts/schemas`, TypeScript values/types in
  `packages/contracts/src`, and Go mirrors in `packages/contracts`.
- Update OpenAPI, JSON Schema, TypeScript, Go, and documentation together.
