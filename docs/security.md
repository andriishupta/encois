# Encois Security Baseline

**Status:** proposed repository-wide security baseline  
**Scope:** product architecture, application code, agent execution, integrations, data, and Google Cloud deployment

This document defines the security properties Encois must preserve as it grows. It is intentionally provider-agnostic where possible. Concrete libraries, IAM roles, database policies, and deployment settings must implement these properties rather than replace them.

Encois is a multi-tenant enterprise system. It reads company data, runs bounded investigations, and returns scoped insights. The default product behavior is read-only. Any external write requires explicit approval, authorization, audit, idempotency, and a recovery or rollback plan.

## 1. Security principles

1. **Deny by default.** A missing identity, scope, policy, connector grant, or capability is a denial or an explicit waiting state.
2. **Least privilege.** Every human, service, agent, Activity, integration, token, database role, and cloud identity receives only the permissions required for its current task.
3. **Tenant isolation is a system invariant.** Every tenant-scoped read, write, cache lookup, job, graph query, memory retrieval, object path, and audit event must carry and enforce organization scope.
4. **Authorization is deterministic.** Gemini, ADK, MCP servers, provider responses, and user-provided IDs never decide access control.
5. **Validate at every boundary.** Authentication, authorization, schema validation, output validation, size limits, timeouts, and rate limits apply at the boundary that owns them and again at sensitive downstream boundaries.
6. **Secrets are not application data.** Tokens and credentials belong in a secret or credential system, not in source code, browser state, logs, prompts, Temporal history, graph properties, or general DTOs.
7. **Minimize blast radius.** A compromised user, agent, token, Activity, connector, or service must be unable to access unrelated tenants, workflows, systems, or data.
8. **Evidence over trust.** External data and model output are untrusted input. Persist provenance, freshness, scope, and transformation information with useful results.
9. **Audit without leaking.** Security-relevant actions must be attributable and reviewable without recording secrets, raw sensitive payloads, or hidden model reasoning.
10. **Fail closed for security decisions.** Availability degradation may produce a visible partial result or pause; it must not silently widen access.

## 2. System scope and trust boundaries

The security boundary follows the architecture:

```text
Human / public client
  -> public Gateway API
  -> Temporal Cloud control plane
  -> Go Agent Runtime Worker
  -> private Agent Gateway
  -> provider API / MCP / isolated browser worker

Gateway API -> control-plane database and projections
Agent Gateway -> Cloud Storage, Spanner Graph
Agent Runtime -> Memory Bank through its Activity boundary
```

### Public Gateway API

The public Gateway API is the only public application entry point. It authenticates callers, computes organization scope, validates application requests, and starts or controls approved workflows.

It must not:

- expose Temporal, database, Memory Bank, Spanner Graph, Secret Manager, or provider credentials;
- become an unrestricted proxy for provider APIs or MCP tools;
- accept an organization, role, user, or scope from the client as authoritative;
- execute arbitrary model, shell, browser, network, or provider work from a request;
- expose private Agent Gateway endpoints or internal service addresses.

### Private Agent Gateway

The private Agent Gateway is an internal policy and tool broker. It is not browser-facing and must not have public ingress. It receives requests from an authenticated Agent Runtime identity, validates the execution context and tool policy, obtains a scoped credential, calls an allowlisted provider/API/MCP endpoint, validates the result, and returns the minimum required data or references.

The first implementation may be in-process inside the Go Runtime, but it must use the same explicit interface and policy checks as the future internal service. Extraction into a separate service must reduce, not expand, its trust boundary.

### Agent Runtime and Temporal

Temporal Cloud coordinates execution; it does not authorize provider access. The Go Runtime executes Workflow and Activity code. A Worker identity may access only the queues, stores, model endpoints, and private services required by its deployment role.

Workflow payloads and Signals are untrusted application data. Do not place
secrets, provider tokens, unrestricted raw company data, or large model
responses in Temporal history. Temporal inputs carry identifiers, scope, policy
version, and data references. The internal Gateway-issued execution capability
is the exception: it is a short-lived signed field in the restricted Runtime
execution envelope, forwarded opaquely to the private Agent Gateway and never
returned to the browser, model, provider, logs, or general projections.

The Runtime-to-Gateway Coordinator routes are private application routes, not
browser or public MCP routes. They require the service credential, an
organization header, and (when persistence is enabled) a configured service
user with an active tenant membership and resolved scopes. The Runtime may
submit a proposal or start an approved Blueprint snapshot; it may not use this
boundary to approve a plan or bypass registry authorization. The first slice
uses `X-Encois-Service-Token`; Cloud Run IAM/identity tokens should be layered
on at deployment time.

## 3. Multi-tenant architecture

Multi-tenancy is required from the first persistent model, even when the demo uses one organization.

Every tenant-scoped entity must have an immutable `organization_id` or equivalent tenant key. Scope must be present in:

- database rows and unique constraints;
- API requests, responses, cache keys, and idempotency keys;
- Temporal Workflow IDs, inputs, Signals, search attributes, and projections;
- Cloud Storage object prefixes and authenticated artifact references;
- Spanner Graph nodes, edges, facts, and queries;
- Memory Bank sessions and memories;
- connector credentials and integration grants;
- logs, traces, metrics, audit events, and data-retention jobs.

Authorization must happen before loading the object whenever possible. Object-level authorization must happen again after loading it. A client-supplied tenant ID is only a lookup hint; the server derives the authoritative tenant from the authenticated principal and checked scope.

Tenant isolation must not depend on developers remembering one filter in every query. Use defense in depth:

- application-level authorization and repository methods that require scope;
- database role separation and row-level security where supported;
- tenant-aware foreign keys, indexes, and unique constraints;
- tenant-specific object paths and Agent Gateway authorization;
- tenant-aware graph and memory query wrappers;
- tests for cross-tenant reads, writes, caches, jobs, and error paths.

Shared infrastructure is acceptable only when every access path enforces tenant scope. A shared Temporal namespace, Worker deployment, graph instance, or database must not imply shared authorization.

Temporal Namespace is operational isolation, not the tenant authorization
boundary. The MVP may use one shared Namespace, but every Workflow ID, input,
Signal, Update, visibility query, and projection remains organization-scoped.
Dedicated Namespaces are an enterprise deployment profile; a dedicated GCP
project plus Temporal environment/Namespace is the strongest isolation profile.

## 4. Human identity and authorization

Authentication establishes who the caller is. Authorization determines what that caller may do. They are separate checks.

The Gateway API must:

- validate the issuer, audience, signature, expiry, nonce, and required claims of the chosen identity protocol;
- map the authenticated identity to an Encois membership and organization scope;
- calculate effective permissions from role, explicit grants, hierarchy, resource scope, and integration grants;
- enforce authorization on every request and every object, including read endpoints;
- use secure, appropriately scoped cookies or short-lived access tokens;
- protect browser sessions against CSRF, XSS, token theft, replay, and fixation according to the chosen client model;
- return stable, non-sensitive errors that do not reveal whether unauthorized records exist.

Roles are policy inputs, not permissions by themselves. A role must be combined with organization and resource scope. Typical identities include platform operator, organization administrator, manager, member, integration service identity, and agent-run identity. No role should automatically grant access to all tenants or all providers.

For the Google Cloud baseline, Identity Platform/Firebase ID tokens establish the external identity only. The Gateway verifies the token with Application Default Credentials, maps the subject to the local `users` and `organization_memberships` tables, and computes effective scope from local roles and hierarchy grants. Do not treat arbitrary token claims, email domains, or client-selected organization IDs as authorization.

The MVP human-access policy is invite-only Google sign-in. The Gateway accepts
only the configured Google provider, requires a verified email, and matches it
against a non-expired pending `organization_invites` record before creating an
active local membership. An Identity Platform account without a matching
invite may exist at the provider but has no Encois principal and cannot reach
tenant routes. There is no email/password signup or self-service organization
creation. Invite and waitlist tables are pre-auth control-plane records: they
are reachable only through server-side Gateway/operator code, never through a
client-selected organization context.

The Dashboard must fail closed when no bearer session exists. Its current local
development scaffold stores a tab-scoped bearer session in `sessionStorage`
and accepts a token supplied through a development-only
fixture environment variable; `VITE_*` values are embedded in the bundle and
must never hold a hosted or production credential. The production browser
adapter uses the Identity Platform/Firebase client SDK with Google-only sign-in,
token refresh, logout, and revocation handling, while the Gateway remains the
authorization source of truth. An authenticated but not-invited browser
session may resolve `/api/v1/auth/me` to `pending` and submit the public
waitlist form, but it is not an application session.

Never let the model select a role, organization, user identity, connector, or scope. Never infer authorization from a natural-language request.

The effective scope calculation is deterministic:

```text
direct membership descendants
+ explicit grant descendants
- explicit restriction descendants
```

The current API computes inherited descendants from the organization-unit tree
and enforces role-aware direct membership permission mutations in the Gateway.
Access requests do not mutate permissions directly: they are tenant-scoped,
audited proposals with administrator-only approval, separate apply semantics,
and a different-administrator check for separation of duties. The request path
can only create a non-admin membership scope for the requesting active user;
role permissions and administrator grants remain outside that path.
Explicit grant/restriction persistence is intentionally deferred, but the
contract boundary already models it so the Dashboard cannot replace the
authorization algorithm with client or model logic.
The authenticated principal carries only canonical organization-unit UUIDs in
its effective scope; unit slugs are presentation metadata and must never enter
UUID-backed SQL predicates or runtime authorization payloads.

## 5. Database and persistence security

The control-plane database is owned by the Gateway API if Postgres/Drizzle is selected. The Go Runtime and Agent Gateway do not connect to it merely to fetch application data.

Database requirements:

- separate migration/DDL credentials from runtime application credentials;
- use a runtime role with only required CRUD privileges and no schema-altering permission;
- require organization scope in repository interfaces and query parameters;
- use parameterized queries and validated identifiers;
- use row-level security as defense in depth where practical;
- avoid superuser connections from application services;
- encrypt data in transit and at rest using managed platform controls;
- restrict backups, exports, replicas, and admin consoles to authorized operators;
- define retention and deletion behavior for raw data, facts, memories, projections, and audit records;
- treat database errors and timing as potentially sensitive; do not expose query details to clients.

The initial Google Cloud implementation follows this boundary with Cloud SQL PostgreSQL and Drizzle. The migration connection is separate from the API runtime connection. The runtime capability role has no DDL, role-management, row-delete, or table-delete privileges and must not be the database owner. Tenant-scoped requests set a transaction-local organization context before queries; PostgreSQL RLS is defense in depth, not a replacement for Gateway authorization.

Workflow plans and Blueprint registry snapshots are tenant-scoped control-plane
records. Only an authorized manager may move a plan through proposal, approval,
and application; applying a plan must materialize only validated Blueprint JSON
and must not execute arbitrary code. The Go Runtime receives a snapshot through
Temporal input and never receives database credentials or queries the registry.
Registry rows should be append-only by version in normal operation; lifecycle
changes must be explicit, audited, and never implemented as an implicit delete.

Workflow Template catalog rows are either platform-wide (`organization_id IS
NULL`) or explicitly tenant-scoped. The templates endpoint is still behind
AOS and establishes tenant context before reading RLS-protected rows. Published
templates are configuration, not executable workflows: they may contain
logical capabilities and provider slots, but never credentials, provider tokens,
integration IDs, raw provider payloads, or arbitrary code. A selected template
must pass the same deterministic Blueprint validation, authorization, approval,
and audit boundary before it can become a tenant workflow.

Knowledge Sources are tenant-scoped control-plane records with separate
immutable revisions and ingestion-run projections. A Source's read and
visibility scope must be checked before acquisition, and the same scope must
be carried into artifact prefixes, provider queries, Graph writes, and Memory
Bank distillation. `artifactRef` is a typed reference, not a URL to fetch
arbitrarily; only approved `artifact://` or `gs://` references may cross the
source revision boundary. Source configuration must never contain credentials,
even nested inside JSON.

Spanner Graph, Cloud Storage, Memory Bank, and any vector or retrieval system follow the same tenant, scope, retention, and service-identity rules. A graph edge or memory retrieved without an authorization filter is a security defect even if the UI later hides it.

## 6. Secrets and credentials

Store API keys, OAuth client secrets, refresh tokens, signing keys, service credentials, and encryption material in Secret Manager or an equivalent managed credential system.

Requirements:

- never commit secrets, put them in `.env` files tracked by Git, or include them in screenshots or fixtures;
- inject secrets only into the service that needs them, preferably at runtime;
- use separate credentials for local, staging, demo, and production environments;
- use workload identity or short-lived service credentials instead of long-lived service-account keys;
- rotate and revoke credentials; document the owner and recovery path;
- do not send credentials to the browser, model, MCP server unless that connector explicitly requires it, Temporal history, logs, traces, graph, Memory Bank, or generic error responses;
- redact authorization headers, cookies, query-string secrets, provider tokens, and artifact references before logging;
- treat secret values returned by providers or tools as sensitive even when the schema does not mark them.

Connector credentials are resolved at the Agent Gateway. Agents request a capability; they do not receive a provider token. A provider token must be bound to the organization, integration, allowed scopes, and intended service identity.

## 7. Execution-scoped capability tokens

An execution-scoped token may be useful for a narrow use case such as polling the result of one workflow from a trusted callback or limited client. It is not a replacement for user authentication, service identity, or provider credentials.

The token must be an opaque, high-entropy capability or a signed token with equivalent protections. Bind it to:

```text
organization_id
logical investigation/workflow ID
specific execution or result resource
allowed operation(s), normally read-only
intended audience
issued_at and short expiry
policy/version context
optional actor or callback binding
```

The server must store only a hash of an opaque bearer token when a revocation lookup is needed. It must never store the raw token in logs or general application records. A signed token must still be checked against current workflow ownership, tenant scope, status, expiry, and revocation state; signature validity alone is not authorization.

Recommended behavior:

- issue it only after a normal authenticated request;
- scope it to one workflow/result, not an organization or API generally;
- allow only explicitly listed read operations;
- make it valid only while the execution is active, or until a bounded maximum TTL; revoke it on cancellation, deletion, security incident, or workflow completion when no longer needed;
- make it single-use for one-time callbacks where possible;
- never put an external/client-facing capability in a URL, browser history,
  model context, provider request, or log; the restricted internal execution
  capability may travel only in the signed Runtime-to-Agent-Gateway envelope;
- return a generic unauthorized response for wrong workflow, tenant, audience, or operation;
- rate-limit and monitor use;
- never allow it to create another Workflow, access graph/memory broadly, delete data, change permissions, or invoke a provider tool.

Retries require a distinction between a logical Workflow and an Activity attempt. A retry of the same logical execution may use a new short-lived internal capability or a server-side reference; it must not require exposing a reusable provider credential. If a token is valid for the logical Workflow, its permissions remain limited to that Workflow's result and the token's expiry, not to the retrying Worker or the organization.

If an execution token is exposed, the expected blast radius is one bounded result within one tenant and time window. If exposure could reveal more than that, the token is too broad.

## 8. Agent and Activity security

An agent is an untrusted planner operating inside a bounded system. It is not a principal with unrestricted application authority.

Every Agent Definition must specify:

- purpose and owner;
- input and output schemas;
- allowed tools and required integration scopes;
- organization and resource scope rules;
- model, token, time, concurrency, and cost budgets;
- retry and timeout policy;
- allowed side effects, normally none;
- evidence and provenance requirements;
- behavior for missing capability, denied policy, invalid output, and stale data.

Every Activity must be narrow and independently enforceable. It must validate inputs, use an explicit allowlist, enforce timeout and size limits, avoid arbitrary shell/code execution, apply idempotency for side effects, and return the minimum required output. A Workflow or agent must not be able to turn a read Activity into a write by changing a tool name or payload.

Activities must not trust:

- model-generated tool names or arguments without registry and schema validation;
- instructions embedded in Jira, GitHub, documents, web pages, MCP results, or browser content;
- user-provided tenant IDs or permission claims;
- provider responses that request credentials, policy changes, or unrelated actions;
- cached authorization decisions after their validity window.

Prompt injection and tool poisoning are treated as data-integrity and authorization threats. External text may influence a recommendation only after it is labeled as evidence and bounded by deterministic policy. It cannot override system policy, tool scope, or approval requirements.

## 9. Agent Gateway security

The Agent Gateway must enforce the final authorization boundary before an external call:

```text
authenticated service identity
  -> valid contract and execution context
  -> registered Agent Definition and tool
  -> current tenant and resource scope
  -> integration grant and provider permission
  -> host/method/path/payload allowlist
  -> credential resolution
  -> provider/API/MCP call
  -> output validation, redaction, provenance, and audit
```

It must:

- use authenticated service-to-service communication and internal ingress;
- reject requests without a valid execution context;
- verify that the requested tool belongs to the approved Agent Definition and enabled Integration Pack;
- recompute or verify effective scope rather than trusting the model or caller;
- prevent SSRF with host, scheme, method, path, redirect, DNS, and egress controls;
- isolate browser automation in a sandbox with domain and action allowlists;
- enforce provider rate limits, timeouts, concurrency, response-size, and pagination limits;
- redact secrets and unnecessary PII before returning data to the agent or model;
- classify policy, authentication, provider, validation, and rate-limit errors separately;
- create an audit event for denied, approved, and executed sensitive operations.

The Agent Gateway must not become a general-purpose HTTP fetcher. “Custom tool” means a reviewed adapter with a declared contract and policy, not arbitrary URL access.

## 10. Data, model, and memory protection

Data should be classified before it is ingested. At minimum distinguish public, internal, confidential company data, credentials, personal data, and highly sensitive security or financial data.

Use data minimization:

- fetch only fields required for the investigation;
- filter by organization and authorized hierarchy before model calls;
- keep raw provider payloads in retention-controlled storage;
- store normalized facts and evidence references separately from raw data;
- store only useful, scoped distillations in Memory Bank;
- do not put unrestricted company data in prompts or persistent agent memory;
- preserve source, observed time, freshness, transformation version, and visibility scope;
- define deletion and export behavior across raw data, graph, memory, Temporal projections, caches, and audit records.

Memory distillation must pass this boundary before a provider write:

```text
raw evidence -> schema/provenance validation -> PII/secret filtering
  -> fact extraction -> concise distillation -> scoped Memory Bank
```

The current `regex-v1` adapter redacts obvious emails, phone numbers, bearer
tokens, and common API-key shapes using the Go standard library. It is a
defense-in-depth baseline, not proof that all PII is removed. Provider-aware
classification, configurable sensitive-field policies, and optional
model-assisted review remain TODOs. A Memory provider must re-check the
boundary on write and retrieval; Memory is never an authorization source.

Graph facts may contain a necessary person/business identity, but should retain
only minimal fields and provenance. Do not store raw messages, private email,
credentials, or unrestricted provider payloads in graph properties. Every fact
and evidence projection carries source, observed time, ingestion time,
transformation version, visibility scope, and freshness where available.

Model output is untrusted. Validate structured output, cap sizes, reject unsupported claims, distinguish observed facts from inference, and show evidence and freshness to users. Do not log chain-of-thought. Store concise decisions, tool calls, evidence references, outcomes, and error classifications.

## 11. Network and deployment security

- Public services expose only required routes with explicit CORS, content type, body size, timeout, and rate-limit policies.
- Private Agent Gateway and internal stores use private connectivity or internal ingress where supported.
- Cloud Run services use separate service identities and least-privilege IAM.
- Worker and gateway egress is restricted to approved Google and provider endpoints.
- Staging and demo environments use synthetic or authorized data and separate credentials.
- Health endpoints do not call models, providers, or mutating systems; readiness checks verify only required dependencies.
- Deploy immutable revisions with pinned dependencies, vulnerability scanning, secret scanning, and a documented rollback path.
- Administrative access requires strong authentication, separate operator roles, and audit logging.

## 12. Audit and observability

Audit events must answer:

```text
who acted
what action was requested and executed
which organization, resource, Workflow, and Agent Run were involved
when it happened
which policy and integration scope applied
whether it was allowed, denied, paused, retried, or completed
what evidence or result reference was produced
```

Keep audit records separate from debug logs. Logs and traces must include correlation, trace, organization, actor, workflow, run, activity, and agent identifiers where safe, but must exclude tokens, cookies, authorization headers, raw sensitive bodies, unrestricted prompts, and chain-of-thought.

Security-relevant alerts include cross-tenant authorization failures, repeated denied tool calls, unusual token use, credential errors, policy bypass attempts, unexpected egress, excessive data volume, and repeated prompt-injection/tool-poisoning signals.

## 13. Reportable findings and severity context

Report a security finding when a realistic attacker, compromised identity, malicious tenant user, malicious provider content, or compromised integration can violate a security invariant.

Highest-priority findings include:

- cross-tenant data access or scope bypass;
- authentication bypass or account takeover;
- public exposure of Agent Gateway, internal services, database, Temporal credentials, or provider credentials;
- execution token that can access unrelated workflows, tenants, mutations, or provider tools;
- agent or model path that bypasses deterministic policy or approval;
- secret leakage through logs, prompts, traces, Temporal history, errors, or client responses;
- SSRF, arbitrary code execution, unrestricted browser automation, or unsafe write capability;
- audit records that can be forged, suppressed, or materially misattribute a sensitive action.

Severity is based on reachability, required privileges, tenant scope, data sensitivity, persistence, and blast radius. A theoretical issue with no reachable path may be lower priority, but tenant isolation and secret-handling defects remain security-relevant even in the hackathon MVP.

## 14. Out of scope and known limitations

The following are deferred product capabilities, not permissions to ignore security bugs:

- autonomous writes to external systems;
- arbitrary customer-created agents;
- unrestricted browser automation;
- marketplace or third-party pack distribution;
- customer-specific data residency and dedicated deployment profiles;
- advanced SSO, enterprise key management, and formal policy administration.

The MVP may use simplified UI and synthetic data, but it must still enforce authentication, tenant scope, least privilege, secret separation, read-only tools, input validation, auditability, and bounded execution. “Demo-only” is not an accepted reason for a cross-tenant leak, exposed credential, or policy bypass.

## 15. Security review checklist

Before shipping a component or vertical slice, verify:

- [ ] public routes authenticate and authorize before loading tenant data;
- [ ] the invite-only boundary verifies the Google provider, verified email, invite status, and expiry before provisioning a local membership;
- [ ] pending/unknown identities cannot reach tenant routes, and waitlist data is not used as an authorization source;
- [ ] every query, cache, job, graph, memory, object, and audit record is tenant-scoped;
- [ ] database runtime roles cannot alter schema or access unrelated tenants;
- [ ] secrets are in managed secret storage and absent from code, logs, prompts, and Temporal history;
- [ ] Agent Gateway is private, authenticated, allowlisted, and the final policy check;
- [ ] each agent and Activity has a narrow tool, scope, timeout, budget, and output contract;
- [ ] execution capabilities are workflow-bound, operation-limited, short-lived, revocable, and non-provider credentials;
- [ ] external writes are approval-gated, idempotent, auditable, and recoverable;
- [ ] model and provider content is treated as untrusted data;
- [ ] raw data, graph facts, memory, projections, and audit records have retention and deletion behavior;
- [ ] invite and waitlist PII has a documented retention/deletion policy before real customer rollout;
- [ ] Memory writes pass deterministic redaction before provider persistence, with a documented limitation for semantic PII;
- [ ] stale source data is marked stale/unknown and cannot be presented as fresh;
- [ ] logs and traces are redacted and still provide useful correlation;
- [ ] tests cover auth failure, tenant isolation, policy denial, token replay, prompt injection, tool poisoning, provider failure, and oversized input.

## 16. Incident response baseline

For suspected exposure, stop the affected capability or integration first, revoke exposed credentials and execution tokens, isolate the affected tenant or Workflow, preserve redacted audit evidence, assess access scope, and notify the responsible operator. Do not delete logs or raw evidence before the investigation determines retention requirements. After containment, rotate credentials, patch the boundary, add a regression test, and document whether any tenant or personal data was accessed.
