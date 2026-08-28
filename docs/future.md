# Future product direction

## Dashboard: Pel AI workspace assistant

Dashboard is the authenticated entry point for people who may never open the operational pages. It should feel like a second brain for the current organization scope, not like a monitoring console.

- Greet the user by their account name and explain what changed in the visible scope.
- Present a grounded morning brief with recent, evidence-backed changes.
- Let the user ask questions such as “What changed last week?” or “What should I know today?”
- Support text chat first and voice input/output later through the same scoped assistant context.
- Add quick actions such as Run workflow and Check integrations without making technical queues the primary content.
- Show email, calendar, Slack, and other personal signals only after the user explicitly connects and authorizes them.
- Keep suggested actions visibly marked as unavailable or coming soon until the API can execute them.

The Dashboard must never manufacture an insight, activity event, connection, or suggested action. Until assistant APIs exist, the UI may show real workflow activity and clearly labelled coming-soon surfaces only.

## Activity: technical operations view

`/activity` replaces `/review` as the technical inbox. It gathers operational work without making it the Dashboard’s primary experience:

- waiting approvals;
- running workflow runs;
- failed or partial runs needing attention;
- source attention;
- integration setup;
- workflow plan and memory-change approvals;
- organization access requests.

Summary cards link to the owning product surface. Individual rows link to the relevant workflow, source, integration, or organization request. Workflow run links should lead to the aggregate Runs page when the user asks to see the complete run history.

## Real integrations, Sources, and Workflows

The hackathon MVP does not need live provider authorization to demonstrate the
product. It should keep the real control-plane model and use deterministic
provider adapters at the edge. This makes the demo executable without OAuth,
provider credentials, or production data while keeping the later migration to
real integrations straightforward.

The product model is deliberately split into two levels:

```text
Organization Integration
  -> provider authorization, credential reference, capabilities, health

Organization Unit Source
  -> selected repository, project, board, channel, folder, or document scope
  -> read scope, visibility scope, freshness, and provenance

Source + Workflow Template / Blueprint
  -> provider binding resolution
  -> approved Workflow Run
  -> evidence-backed result
```

An **Integration** is configured once for an organization. For example, an
organization administrator installs a GitHub App or completes Jira OAuth and
grants access to a set of repositories or projects. Credentials remain in a
secret store and are never copied into a Source or sent to the browser.

A **Source** is the resource selection made available to an organization unit.
An Engineering manager may select three GitHub repositories; a Customer
Success manager may select a Jira project or board. The Source references the
existing Integration and stores only the provider resource identity and
Encois scope. The same Integration can therefore support many unit-level
Sources without creating duplicate credentials.

Workflow Templates and Blueprints remain provider-neutral. They declare logical
capabilities such as `code.read` or `issues.read`, not OAuth tokens or provider
SDK calls. During preview and submission, the Gateway resolves each provider
slot against an active Integration and a matching Source in the selected
organization scope. The generic Workflow then executes typed steps through the
Agent Gateway, which performs the final policy and provider access checks.

### Provider adapters and UI

The shared integration layer should expose a small adapter contract:

- authorize or attach provider credentials;
- report health and capabilities;
- discover resources available to the organization;
- validate a selected resource;
- read provider data for a Source;
- optionally receive webhooks or scheduled sync requests.

The Dashboard should provide a common flow for authorization, resource
selection, scope, freshness, and errors. The resource picker may be provider-
specific: GitHub needs repository and installation selection, while Jira needs
project/board selection. These pickers should remain small provider modules,
not separate product applications, until a provider requires substantially
different interaction or permissions.

For the MVP, the GitHub and Jira adapters can return deterministic resource
catalogs and evidence fixtures. Mock mode must use the same request/response
contract and failure semantics as the real adapter, remain limited to the
provider boundary, and be explicitly enabled by runtime configuration. It must
not fabricate organization, permission, Source, Workflow, or Run state.

### GCP, AWS, and customer-owned deployment paths

The product contracts should not depend on a cloud SDK. A reference GCP path
and a future AWS path can implement the same ports:

| Product boundary | GCP implementation | Possible AWS implementation | Customer-owned option |
| --- | --- | --- | --- |
| Provider secrets | Secret Manager | AWS Secrets Manager | Customer secret service |
| Raw artifacts | Cloud Storage | S3 | Customer object storage |
| Organization Memory Graph | Spanner Graph | Neptune or another graph adapter | Customer graph API |
| Workflow Memory | Agent Platform Memory Bank | AWS/provider memory or vector adapter | Customer memory API |
| Control-plane database | Cloud SQL / PostgreSQL | RDS or Aurora PostgreSQL | Customer PostgreSQL/API |
| Runtime compute | Cloud Run / GKE | ECS, EKS, or Lambda where suitable | Customer Kubernetes/compute |
| Events and scheduling | Pub/Sub / Cloud Scheduler | EventBridge, SNS/SQS, or Scheduler | Customer event platform |
| Durable Workflows | Temporal Cloud | Temporal Cloud or self-hosted Temporal | Customer Temporal deployment |

These are adapter choices, not a requirement to support every service in the
MVP. Portability comes from keeping `SecretProvider`, `ObjectStore`,
`GraphStore`, `MemoryStore`, `ProviderAdapter`, and `WorkflowClient` small and
provider-neutral. Terraform should describe environment-specific resources,
while application contracts and authorization remain unchanged.

In a customer-owned deployment, Encois can keep Workflow execution and policy
at its boundary while calling a customer API for memory, graph, artifacts, or
provider data. The customer adapter must authenticate service-to-service,
bind every request to organization and visibility scope, separate read and
write capabilities, enforce bounded retries and payloads, and return normalized
evidence with provenance. The external database schema must never become the
product contract or the authorization source.

The resulting real-provider flow is:

```text
Admin authorizes Integration
  -> provider credential stored as a secret reference
  -> provider adapter discovers available resources
  -> unit manager creates a scoped Source
  -> Source is ingested or queried by a Workflow
  -> Agent Gateway re-checks identity, capability, and scope
  -> Temporal runs the approved Workflow
  -> API exposes scoped status, evidence, freshness, and audit history
```

No cloud migration or live OAuth implementation is implied by the MVP. The
important decision now is to preserve these boundaries so real GCP, AWS, and
customer-owned adapters can be added without changing the Workflow, Source, or
permission model.

## Provider-neutral memory and storage plane

The current MVP keeps provider access behind three small boundaries:

| Boundary | Current implementation | Future replacement options |
| --- | --- | --- |
| Organization Memory Graph | Local adapter or tenant-keyed Spanner projection | Spanner Graph views, another graph store, or a customer-owned graph API |
| Workflow Memory | Local adapter or Agent Platform Memory Bank adapter | Exact scoped provider reads, an Encois filtered projection, AWS memory, or a customer-owned memory API |
| Raw Artifacts | Local process adapter or Cloud Storage | S3-compatible storage or a customer-owned artifact API |

The product contract should remain provider-neutral: organization ID,
authorized visibility scope, actor/workflow/request IDs, provenance, freshness,
retention, classification, and redaction state. GCP, AWS, or customer-provider
IDs and SDK payloads stay inside adapters. Product UI and permissions should
continue to use terms such as Organization Memory Graph and Workflow Memory,
not provider names.

The current local and GCP paths are not equivalent in all respects. The API
already authorizes organization-unit scope, and the Graph projection carries
visibility scope. The current Agent Platform Memory Bank adapter uses exact provider
scope keys for organization, agent, and optional project/user, but does not yet
materialize the full Encois unit hierarchy inside Memory Bank. A future change
must choose between exact per-scope reads, a trusted Encois-side filtered
projection, or a customer-owned scoped store. Provider failure to support the
requested scope must fail closed rather than widen the result.

Cloud Storage object prefixes are defense in depth and support retention and
ownership boundaries, but API authorization remains authoritative. Direct
bucket listing must not be used as a user-facing access mechanism.

The canonical current/future behavior and security invariants are in
[`memory.md`](memory.md). No provider migration or database rewrite is implied
by this direction.

### Future: periodic source and memory summarization

Source ingestion currently projects extracted facts into the Organization
Memory Graph and distills source content into Workflow Memory. Graph reads are
bounded, so a growing collection of daily documents will eventually need a
scheduled, scope-aware summarization pass. That pass should summarize related
or older facts into versioned memory entries while preserving original fact
provenance, source revisions, observation windows, and evidence references.

The summarization must be incremental and idempotent: run after a fact-count or
time threshold, avoid repeatedly summarizing unchanged material, and never
replace source facts before retention and deletion rules exist. Derived memory
summaries must remain clearly separate from observed graph facts and raw source
content.

### Future: connected Organization Memory Graph

The Organization Memory Graph should become a connected, evidence-backed model
of the organization rather than a collection of unrelated source facts. The
Graph is the right place for durable cross-source relationships; Workflow
Memory remains the short-lived, workflow-scoped context used during execution.

The current source ingestion path creates `source_fact` nodes with empty edge
lists. Multiple PDFs, Jira records, and GitHub records therefore remain
separate even when they describe the same project or system. Spanner does not
infer relationships automatically: every edge must be produced by an Encois
ingestion or linking step.

The target model should use a small set of canonical node types and explicit
relationships:

```text
Source Revision ──CONTAINS──> Source Fact
Source Fact ──MENTIONS──> Canonical Entity
Jira Issue ──BELONGS_TO──> Project
GitHub Pull Request ──CHANGES──> Repository
Project ──RELATES_TO──> Dashboard or Team
Canonical Entity ──SAME_AS──> Canonical Entity
```

Every node and edge must retain `provenance_json` with the source, revision,
artifact reference, observation time, transformation version, and visibility
scope. `properties_json` should contain only the normalized attributes of that
node or edge, such as a Jira key, repository name, status, or fact text. Raw
documents remain in object storage and must not be duplicated into Graph
properties.

The linking pipeline should be incremental and idempotent:

1. Ingest each Source Revision and create stable source/fact IDs.
2. Extract typed entities and relations from the source using deterministic
   provider fields first: Jira keys, GitHub URLs, repository IDs, project IDs,
   and exact names within the authorized scope.
3. Upsert canonical entities using stable organization-scoped identity keys.
4. Create edges with a relationship type, transformation version, provenance,
   and optional confidence.
5. Use model-assisted entity resolution only for ambiguous cross-source links.
   Store the proposed match and evidence, then apply deterministic thresholds
   or an approval step; never let a model silently authorize or widen scope.
6. Deduplicate edges with a stable key such as organization, source node,
   relationship, target node, and transformation version.

For the MVP, implement only the reliable foundation: `Source Revision →
Source Fact` edges and canonical entities for provider records with stable IDs.
Add cross-provider links such as Jira-to-GitHub or document-to-dashboard after
the entity and relationship schemas are stable. Queries should return the
connected nodes, edges, evidence references, freshness, and scope-filtered
provenance together, with bounded result limits. Summaries may compress older
facts later, but must preserve links to the original facts and source
revisions.

### Customer-owned memory option

Some customers may require company memory and raw artifacts to remain in their
own environment. A future customer adapter can call a versioned Encois API
implemented by that customer. It must use authenticated service-to-service
access, bind organization and visibility scope to the customer identity, keep
read/write capabilities separate, enforce bounded payloads and retries, and
return normalized evidence with provenance. Encois should not depend on the
customer's database schema or treat the external store as the authorization
source.

This is a future deployment option, not a current local mode. The first
implementation step is contract-level scope semantics and adapter tests; AWS
or customer-specific integrations should wait until those contracts stabilize.

## Future API boundary

The current UI change does not require API changes. When assistant behavior is implemented, add explicit, organization- and unit-scoped contracts for:

1. briefing generation with evidence and freshness;
2. conversation history and streaming responses;
3. user-authorized email/calendar/Slack context;
4. suggested actions with permission, approval, and audit metadata;
5. voice transcription and optional speech output.

Assistant output remains untrusted model output: validate it at the API boundary, preserve evidence references, apply deterministic authorization, and require explicit approval before any external write.
