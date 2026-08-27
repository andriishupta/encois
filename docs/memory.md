# Memory, graph, and artifact model

This document separates the current MVP behavior from the provider-neutral
direction for company context and agent memory. It is intentionally explicit
about what is implemented today and what remains a future design.

## Vocabulary

| Product term | Meaning | Source of truth |
| --- | --- | --- |
| Organization Memory Graph | Structured organization context: units, people, systems, relationships, facts, provenance, freshness, and visibility | Graph persistence and normalized evidence |
| Workflow Memory | Scoped semantic distillations used by a workflow or agent across executions | Memory provider adapter |
| Raw Artifact | Uploaded file, provider snapshot, or large result referenced by a typed artifact reference | Cloud Storage or local artifact adapter |
| Workflow History | Temporal state, Activity results, retries, Signals, and execution events | Temporal; operational history only |
| Control-plane projection | Users, permissions, Sources, workflow definitions, runs, and audit records | API Gateway/Postgres |

Memory is not one universal database. The graph is the canonical structured
context; Workflow Memory is an explicitly scoped derived projection; raw
artifacts retain source material; and Temporal retains execution history.

## Current MVP flow

```text
Organization Integration + unit Source / provider
  -> API Source + immutable Revision
  -> typed artifact reference
  -> Temporal source-ingestion workflow
  -> Go Runtime acquisition and normalization
  -> Agent Gateway policy check
  -> Graph facts with provenance and visibility scope
  -> optional redacted Workflow Memory distillation
  -> API projections and user-visible evidence
```

The API authenticates the person, resolves the organization membership and
effective organization-unit scope, checks the relevant permission, and sends
only validated IDs, scope, references, and execution capabilities downstream.
The Go Runtime does not query the control-plane database. The Agent Gateway
owns provider access and must enforce the organization and execution boundary
again.

## What is implemented now

### Organization Memory Graph

The current Graph boundary is a `GraphStore` with local-memory and Spanner
adapters. The Spanner MVP projection uses tenant-keyed node and edge tables;
the organization ID is part of the key and every read is filtered by it. The
local adapter applies the same organization key in memory.

Graph facts also carry a visibility scope. A query is allowed only when the
requested scope is authorized and overlaps the fact's visibility scope. Facts
with no visibility scope are currently treated as organization-visible. That
is useful for organization structure, but ingestion must set visibility
explicitly on sensitive facts; missing scope must never be used as a way to
hide a security mistake.

The API graph service checks `ContextRead`, verifies that requested unit IDs
are within the caller's effective scope, and sends an execution-scoped
capability to the Agent Gateway. The graph provider is not the authority for
human permissions.

### Workflow Memory

The current Runtime boundary is a `MemoryStore` with a local mock adapter and a
Agent Platform Memory Bank adapter. The API checks `MemoryRead` for retrieval and
`MemoryManage` for memory changes. Memory changes are persisted as typed,
scoped proposals and require the existing approval/apply boundary.

The current provider scope sent by the GCP adapter consists of:

```text
organization_id
agent_definition
optional project_id
optional user_id
```

Agent Platform Memory Bank uses exact scope matching. The current adapter does not yet
encode the Encois organization-unit hierarchy into the provider scope. The API
does carry the caller's Encois unit scope into the request and authorizes it,
but this must not be described as complete unit-level isolation inside Agent Platform
Memory Bank. A future change is required if Memory Bank records themselves
must be independently partitioned by department, team, or project.

The local Memory adapter is deterministic and process-local. It is suitable
for API/Runtime contract and permission walkthroughs, but its data is lost when
the Runtime restarts and it does not prove Agent Platform Memory Bank behavior.

Workflow results can contain a summary derived from memory or evidence. A user
with workflow-result access may therefore see the approved result without
having direct `MemoryRead`; this is expected, but result construction must
apply output scope, classification, redaction, and provenance rules.

### Raw artifacts

The API stores uploaded Source metadata, immutable revisions, ingestion runs,
and typed references in the control plane. Hosted Cloud Storage keys include
the organization prefix, for example:

```text
organizations/{organizationId}/sources/{sourceId}/revisions/{revision}.pdf
```

The private Agent Gateway authorizes Runtime artifact reads and performs the
Cloud Storage access. The bucket remains private and the browser does not get
an unrestricted object URL.

Without GCS configuration, the API and Agent Gateway use separate local
process-level artifact adapters. Local source tests therefore prove metadata,
references, and ingestion behavior, but not durable or shared raw bytes.

### Temporal

The MVP uses one local or hosted Temporal Namespace selected by deployment
configuration. Local runs use Namespace `default` and the
`encois-agent-runtime` task queue. Organization-prefixed Workflow IDs,
validated payload scope, API authorization, and Agent Gateway capabilities are
the tenant boundary. A Temporal Namespace is operational isolation, not a
replacement for organization authorization.

## Security invariants

1. Every graph query, memory request, artifact reference, cache key, run,
   audit event, and provider call carries organization scope.
2. Organization-unit scope is computed by the API from membership and
   persisted scope. It is never accepted from a browser, model, provider, or
   arbitrary Temporal payload as an authorization decision.
3. `ContextRead`, `MemoryRead`, and `MemoryManage` remain separate decisions.
   Hiding a button in the Dashboard is not authorization.
4. The Agent Gateway re-checks organization, workflow, actor, capability,
   policy version, tool allowlist, and requested scope before provider access.
5. Memory is derived data, not an authorization source. Retrieval and write
   paths must apply the same scope, classification, retention, and redaction
   rules as ingestion.
6. Temporal payloads contain IDs, validated scope, references, and bounded
   configuration. They must not contain provider credentials, unrestricted raw
   documents, or hidden model reasoning.
7. Missing provider data, missing scope, and adapter failure remain visible as
   unavailable/failed states. They must not be converted into an empty,
   successful, or organization-wide result by a UI fallback.

## Provider constraints that shape the design

These are provider facts, not assumptions about Encois behavior:

- [Spanner Graph with graph views](https://docs.cloud.google.com/spanner/docs/graph/graph-with-views-how-to)
  supports graph views and access-control patterns over a permitted subset.
  [Spanner fine-grained access control](https://docs.cloud.google.com/spanner/docs/fgac-about)
  controls database roles and relational objects; it does not automatically
  understand Encois's user-to-unit hierarchy. Encois still needs API scope
  resolution and provider-side filtering or views for sensitive facts.
- [Agent Platform Memory Bank scope](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/fetch-memories)
  is a dictionary/map and retrieval returns memories for the exact same scope.
  [Memory resources](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/projects.locations.reasoningEngines.memories)
  treat scope as immutable and do not provide an Encois-style hierarchical
  wildcard. Hierarchical access therefore needs explicit scope mapping,
  multiple authorized reads, or an Encois-side filtered projection.
- [Cloud Storage IAM conditions](https://docs.cloud.google.com/storage/docs/access-control/iam)
  and [managed folders](https://docs.cloud.google.com/storage/docs/managed-folders)
  can restrict object-name prefixes. Object paths are defense in depth, not a
  replacement for API authorization. Object listing is bucket-level, so the
  product must not grant users direct bucket/list access as a way to implement
  unit security.

## Future provider-neutral design

The product should depend on small ports, not on GCP SDK types:

```text
GraphStore       -> Spanner Graph adapter | future AWS graph adapter | customer API
MemoryStore      -> Agent Platform Memory Bank | future AWS memory adapter | customer API
ArtifactStore    -> Cloud Storage         | future S3 adapter        | customer API
```

The shared contracts should carry provider-neutral data:

```text
organizationId
visibilityScope: organization-wide | one or more authorized unit IDs
actor / workflow / request / trace IDs
provenance, freshness, retention, classification, redaction state
```

Adapters translate this contract into provider semantics. Provider names such
as Spanner, Agent Platform, GCS, AWS, or customer systems must not leak into product
permissions or UI terminology. Provider-specific IDs and error details stay
inside the adapter boundary.

### Scope mapping options

The future design has three viable patterns; the first is the most direct for
the current hierarchy:

1. **Exact provider scopes.** Materialize one exact memory scope per Encois
   visibility scope and issue one provider read per authorized scope. Merge,
   deduplicate, and re-check results in Encois. This matches Memory Bank's
   exact-scope semantics but increases reads.
2. **Encois filtered projection.** Keep provider memory in a service-owned
   scope, attach immutable Encois visibility metadata, and filter after
   retrieval before model use or user output. This requires a trusted adapter
   and careful protection against over-fetching.
3. **Customer-owned scoped store.** The customer owns the graph, memory, or
   artifact service and exposes a reviewed API implementing the Encois
   contract. Encois sends only the minimum scoped request and receives
   normalized evidence or memory records.

No pattern makes the provider the final permission authority. The API and
Agent Gateway must still authorize the request, and the adapter must fail
closed if it cannot apply the requested scope.

### Customer-owned memory API

For customers that do not want Encois to retain company memory, a future
adapter can call a customer-hosted API. It should require:

- a versioned Encois Memory contract for query, write, update, and delete;
- mutually authenticated service identity or short-lived OIDC credentials;
- organization and visibility scope bound to the authenticated customer,
  never trusted only from a request body;
- request, trace, workflow, and policy-version correlation;
- explicit read/write capability separation and customer-side audit events;
- bounded timeouts, retries, payload sizes, pagination, and rate limits;
- no provider credentials or unrestricted raw data in Temporal or model input;
- a documented deletion, export, retention, residency, and incident path.

The customer API can be implemented over an existing customer database or
memory service. Encois should receive normalized records and provenance rather
than depend on a customer's database schema. A customer-owned adapter is a
future deployment option; it is not part of the current MVP.

## Deferred implementation sequence

1. Keep the current MVP adapters and contracts while testing the full local
   flow and hosted GCP path separately.
2. Add contract-level `visibilityScope` semantics and cross-language tests for
   organization, unit, and descendant scopes before changing provider writes.
3. Extend Graph, Memory, and Artifact adapters one at a time. Preserve the
   current API permission checks and add provider-side isolation tests.
4. Add exact-scope Memory Bank mapping or a filtered Encois projection after a
   decision on read cost, data classification, and retention.
5. Add AWS and customer-owned adapters only after the provider-neutral
   contracts are stable; do not fork product authorization per provider.

The current MVP does not require a database rewrite or a provider migration.
The important immediate rule is to document and test the difference between
API authorization, provider scope, and user-visible workflow results.
