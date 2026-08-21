# Current Review and Next Steps

**Reviewed:** 2026-08-20  
**Scope:** repository state after generic Blueprint execution, Agent Runtime bootstrap planning, workflow-plan persistence, and Agent Runtime execution-profile review

## Review conclusion

The Agent Runtime boundary is now appropriate for the MVP: one Go deployable
creates the Temporal Worker, registers generic Workflows, and runs Activities
that host ADK and call the private Agent Gateway. An Activity, specialist, or
repository fan-out is an execution unit, not a separate microservice. The
Runtime does not connect to Gateway API Postgres and receives scoped,
stateless execution context plus references.

The API's current `WorkflowClient` is already the visibility adapter for this
slice: `get` and `list` read Temporal execution metadata, apply organization
and object visibility in the service layer, and reconcile the safe projection
into Postgres. It is intentionally an adapter inside the Gateway, not another
service. The later visibility consumer in P1 will add push/reconciliation
processing without changing the public API contract.

The current ADK profile is intentionally Activity-boundary durable execution.
The native Temporal/ADK integration remains a focused later spike because it
changes retry granularity and Workflow-history behavior. Do not migrate the
whole interpreter before that spike proves approvals, retries, history size,
and MCP/tool behavior.

The local path is in a good state: API → Temporal → Go Runtime → Agent Gateway
→ synthetic tools → API projection passes, including the waiting/approval
resume path and command replay checks. The remaining work is hardening and
deployment proof, not another runtime decomposition.

## Latest verification

The local multi-process smoke was re-run after the Agent Runtime bootstrap-plan,
workflow-plan persistence, and Blueprint registry changes. It completed with:

```text
API -> Temporal -> Go Agent Runtime -> Agent Gateway -> synthetic Jira/GitHub -> API projection
workflowType: encois.user-blueprint.v1
taskQueue: encois-agent-runtime
runId: 01a020c7-fe34-7dd3-933d-52cc098c9efe
status: completed
```

The same harness also verified the long-running control path: the generic
Workflow reached `running`, the API applied a scoped `blueprint-context`
Update, then sent `blueprint-approval`, and the Go Worker resumed and completed
the same execution.

```text
approvalRunId: 01a020c8-03e5-70a4-a585-39b9822099c9
status: completed
```

The same smoke also verifies idempotency behavior: identical replay returned
`200`, a changed payload under the same release key returned `409
IDEMPOTENCY_CONFLICT`, and the original execution completed. This verifies the
execution boundary and the TypeScript/Go schema validation locally. It does not
verify the hosted Temporal/Cloud Run boundary, Cloud Run IAM, real provider
credentials, or hosted persistence.

Before the positive flow, the same local harness verifies the private Agent
Gateway boundary: an unauthenticated catalog request returns `401`, and a
request using the service token for an unknown tool returns `403`. This proves
the local service-auth and non-allow-all policy path; Cloud Run IAM validation
and hosted identity configuration remain external checks.

## Agent Runtime review

The Runtime is currently one Go deployable, started from
`apps/agent-runtime/cmd/agent-runtime/main.go`. It owns the Temporal Worker and
registered Workflow/Activity implementations; it is not a public API and it is
not one service per agent, repository, or provider.

- `encois.user-blueprint.v1` is the generic company-specific execution path.
- `CoordinatorWorkflow` and `BootstrapProjectWorkflow` are the platform-owned
  lifecycle workflows.
- Google ADK currently runs inside a Temporal Activity. Temporal retries that
  ADK interaction as one Activity; the native `contrib/googleadk` profile is a
  later spike, not the current runtime dependency.
- Tool Activities call the private Agent Gateway with scoped execution context.
  The Runtime has no control-plane Postgres access and cannot approve plans or
  bypass registry/policy checks.
- Current Runtime data dependencies are Temporal, ADK/Vertex or Gemini, and
  Agent Gateway. Memory Bank, Spanner Graph, and Cloud Storage are deferred
  adapters, not active Runtime clients.
- Readiness becomes healthy only after the Worker starts; fatal Worker errors
  mark the service unready so Cloud Run can replace the revision.

Architecture conclusion: do not split this into a Go API, one service per
agent, or one worker per repository. The current deployable is the correct
first boundary. Add separate Worker deployments only when queue isolation,
connector limits, or customer isolation require them. Likewise, Graph,
Memory Bank, and Cloud Storage should enter through typed Runtime Activities
or Agent Gateway/data adapters; they must not turn the Runtime into a second
control-plane API or give it Postgres access.

## Implemented in the current slice

- `packages/contracts` exists with TypeScript types and JSON Schema sources for the generic Blueprint, workflow result, execution context, tool request/result, artifact write/reference, Signals, tool manifests, and Workflow Updates.
- The canonical JSON Schemas now run at the TypeScript boundary through Ajv-2020 for Blueprints, Signals, and Updates; manual parsers still apply domain-specific checks after schema validation.
- The Blueprint contains parallel synthetic Jira/GitHub tool steps and a dependent ADK synthesis step.
- The API passes separate `businessInput`, effective scope, actor, workflow ID, policy version, and request ID to the Go workflow input.
- Stable tenant-prefixed workflow IDs prevent duplicate active investigations for the same project/release. Local Temporal fallback and the Postgres path compare a stable request fingerprint: identical requests reuse the existing projection, while a different payload under the same workflow/idempotency key returns `409 IDEMPOTENCY_CONFLICT`. Real Temporal also uses conflict/reuse policies. Postgres persistence records workflow identity and explicit idempotency keys when configured.
- Identity Platform authentication is now wired conditionally when `IDENTITY_PLATFORM_PROJECT_ID` is configured. The resolver requires a valid local membership and resolves exact organization-unit scope from Postgres.
- Agent Runtime sends a service token, and the Agent Gateway requires it when configured. Hosted configuration additionally supports a Cloud Run ID token audience. The first deterministic policy allows only the two synthetic read-only tools. Tool requests also require a non-empty scope, matching policy version, and object arguments.
- Generic Blueprint payloads are validated at the TypeScript API boundary, and approval Signals now require workflow ownership or `workflows:run`/`workflows:manage` when persistence is enabled. The API rejects Signals for terminal workflows with `409 WORKFLOW_NOT_SIGNALABLE`; accepted Signals are recorded as workflow events when Postgres is configured.
- Postgres now has tenant-scoped `workflow_command_receipts` for Signal/Update delivery. The Gateway claims a command before sending it to Temporal, records `accepted` or `failed`, rejects the same command ID with a different payload, and safely replays `in_flight` commands after an API crash. Temporal Update IDs and Go Signal IDs remain the second idempotency barrier.
- The Go Runtime now validates the workflow contract, execution context, Blueprint identity, step kinds, required tool/agent fields, duplicate step IDs, and dependency references before executing it. Approval Signals carry a required `signalId`; the Workflow ignores duplicate Signal IDs. The generic Workflow also accepts a scoped `blueprint-context` Update and merges it into future Activity input.
- `packages/contracts` now also exposes a Go validator that embeds the same canonical JSON Schemas. Runtime Blueprint/result Activities, Agent Gateway tool request/result boundaries, and the artifact reference boundary use it; service-specific semantic checks remain on top.
- The current ADK execution path runs an approved Agent Definition inside a Temporal Activity. This is durable at the Activity boundary and keeps Workflow code deterministic, but Temporal does not yet observe each internal ADK/model/tool turn as a separate event.
- Temporal's official Go `googleadk` contrib integration is available as separate module `go.temporal.io/sdk/contrib/googleadk@v0.2.0`. Its package tests pass independently. It requires Temporal Go SDK `v1.45.0` and a compatible ADK revision with deterministic time/UUID/task-runner seams; it is not a repository dependency yet. The current Runtime intentionally uses the stable Activity boundary; a focused one-agent migration spike is needed before adopting the native profile.
- The Go Agent Runtime initializes the Coordinator and Workflow Creator ADK capabilities. `BootstrapProjectWorkflow` calls a `CreateBootstrapPlan` Activity and validates a `workflow-change-plan.v1`; raw model output is discarded. `CoordinatorWorkflow` now invokes a typed plan-proposal Activity and a control-plane submission Activity after reconciliation signals or its periodic timer. It remains deliberately read/propose-only for plan creation: source discovery and scheduling remain separate boundaries. An explicit `start` intent on an executable plan change is converted into `workflowStarts` after apply; the Coordinator starts that approved snapshot through a typed private Gateway Activity and retains failed starts in Workflow state for retry.
- The Runtime now has a narrow `corecoordinator.Client`, a service-token/optional Cloud Run ID-token HTTP adapter, and registered control-plane Activities. The adapter can submit a validated plan or start an approved registry Blueprint through `/api/v1/internal/coordinator/*`; it never connects to Postgres. The long-lived Coordinator consumes scoped, deduplicated approval/application events and automatically starts only the approved snapshots named by explicit `start` intents. Hosted Terraform now wires the API URL, audience, service token, and Runtime invoker grant; the service-user membership still has to exist in the target database.
- `workflow-change-plan.v1` is now a canonical cross-language schema with TypeScript types and Go embedding/validation. Bootstrap returns only a validated typed proposal or an explicit `deferred-no-agent-model` status; persistence and application remain Gateway API responsibilities outside the Runtime.
- `workflow-change-plan.v2` is now defined and validated in TypeScript and Go fixtures for lifecycle semantics. It separates Blueprint registry targets from Temporal execution targets. API validate/submit accept v1/v2; apply supports v1 create, v2 Blueprint update/deprecate, and cancel-only Temporal plans through the Gateway Temporal client. Mixed registry/execution plans remain rejected; persistence-backed and hosted cancel verification are pending.
- `coordinator-event.v1` is now a separate generic lifecycle contract from `workflow-signal.v1`. The Go Coordinator receives the event signal, filters organization/Coordinator mismatches, deduplicates event IDs, and updates pending-plan/active-workflow state. Gateway plan approve/apply now enqueue small tenant-scoped events transactionally in `coordinator_event_outbox`; applied plans include `workflowStarts` only for explicit change-level `start` intents. API contract tests prove that approval emits no start and apply emits only explicit starts. The API has a bounded lease/retry dispatcher, Temporal sink, and one-shot `coordinator-dispatcher` entrypoint. Cloud Scheduler/Cloud Run Job deployment and hosted delivery remain pending.
- The Gateway API exposes a non-mutating `POST /api/v1/workflows/plans/validate` preview. It enforces organization identity and required scopes and returns `validated_not_applied`; persistence and application are separate control-plane operations.
- The control plane now has `workflow_change_plans` and tenant-scoped `workflow_blueprints` Drizzle models/migrations plus submit, approve, and apply routes. Approved `create` proposals and v2 Blueprint update/deprecate changes are materialized as tenant-scoped registry snapshots and audited; cancel-only plans call the scoped Temporal client before the plan is marked applied, while Temporal/Coordinator notification is delivered through the transactional outbox and bounded dispatcher. The public examples now match the canonical plan shape: registry changes use Blueprint targets, execution cancellation uses a Temporal workflow target, and create/update changes carry a complete nested Blueprint.
- The Agent Gateway now exposes a fixture-level MCP-shaped capability catalog with tool versions, descriptions, input/output schemas, behavior annotations, availability, approval requirements, and required scope fields. Invocation enforces the registered capability and its required scope after the deterministic policy check. Connector grants, persisted manifests, and live MCP/API discovery remain deferred.
- The Agent Gateway now has a narrow injectable `ArtifactStore` boundary and a tenant/workflow-prefixed in-memory implementation for `POST /v1/artifacts`. The artifact request/result are canonical cross-language schemas embedded and validated by Go; the endpoint returns an immutable-looking reference and rejects path traversal. Router tests prove a future Cloud Storage adapter can be supplied without changing the HTTP, authentication, or policy layers. The real Cloud Storage adapter, object bytes, retention, and hosted IAM remain deferred.
- The Graph boundary now has canonical `graph-query.v1` and `graph-query-result.v1` schemas, Go/TypeScript validators, an injectable `GraphStore`, and a default deferred adapter. The route still fails closed until a scope-aware Spanner implementation and explicit graph policy grant exist; no graph provider or arbitrary raw query execution is enabled.
- Agent-specific memory now has canonical `agent-memory.v1` and `agent-memory-result.v1` schemas plus a Go Runtime `memory.Store` boundary with a deferred adapter. The request supports only scoped `retrieve`/`distill` operations and evidence-linked summaries; it does not persist raw provider data or Workflow history. `ExecuteAgentMemory` is registered as an Activity, applies deterministic `regex-v1` redaction before distillation and on returned records, and returns a typed deferred result until a hosted Memory Bank provider is configured; retention/deletion policy remains deferred.
- The `tool-manifest.v1` schema is now canonical in `packages/contracts` and is embedded/validated by the Go Agent Gateway before catalog responses. This covers the manifest wire shape; persisted registry records and provider discovery remain deferred.
- The dashboard has a typed API client, workflow list/detail queries, polling through React Query, and a form that starts a generic Blueprint. Workflow execution state is no longer kept in localStorage.
- The Go Temporal test suite executes a generic Blueprint with parallel-ready tool steps and a dependent agent step without a Temporal server.
- Coordinator tests cover scoped event deduplication, explicit approved-snapshot starts, and retention/retry of a failed start until a later reconciliation signal.
- Opt-in `pnpm smoke:release` and `pnpm smoke:approval` harnesses exercise the real TypeScript Temporal client, API projection, context Update, and approval Signal path. `pnpm smoke:release:local` now starts the local Temporal dev server, Agent Gateway, and Go Runtime, waits for readiness, runs both smokes, and cleans up.
- The local multi-process smoke path passed again after the Coordinator contract changes: API → Temporal server → Go Runtime → Agent Gateway → synthetic Jira/GitHub tools → completed workflow projection. The approval smoke also passed: API Update → waiting generic Workflow → API Signal → Go Worker resume → completion. The first failed run exposed and fixed missing `policyVersion` propagation.
- The local multi-process smoke was rerun after the command-receipt changes and passed again for both release and approval flows. The duplicate Update was accepted by the local Temporal client. The CI persistence job now applies the migrations and runs both DB-level uniqueness and full API HTTP-route concurrent Update harnesses against ephemeral Postgres; the hosted CI result remains pending.
- The local multi-process smoke now also checks Agent Gateway denial behavior before starting the positive flow: missing service authentication is rejected with `401`, an unknown tool is rejected with `403`, and both release/approval flows still complete.
- Runtime readiness now becomes healthy only after the Temporal Worker starts; fatal worker errors mark the service unready and terminate the process for Cloud Run restart. Agent Gateway readiness also fails closed when its service token is missing.
- Basic observability is present: API request IDs and structured request logs, trace-context correlation from `traceparent`/`X-Trace-ID`, Temporal workflow/run IDs in projections, workflow audit events, and structured Go Runtime/Agent Gateway logs. OpenTelemetry export and a push-based visibility consumer remain pending.
- Full TypeScript workspace tests, lint, typechecks, and builds pass locally; shared-contract, Agent Gateway, and Agent Runtime Go tests/builds plus `go vet` also pass. Repository CI now covers these checks, runs the local Temporal/Go smoke with a pinned CLI, applies and verifies migrations against ephemeral PostgreSQL, builds all four container images without pushing, and initializes/validates Terraform without a backend; the hosted CI result remains to be observed.

## Architecture addendum audit

| Addendum | Current state | Next boundary |
| --- | --- | --- |
| Organization-unit tree | Direct organization/dept/team/project roots existed; hierarchy expansion is now computed by the Gateway and contract helper; service/custom unit types are in the schema contract | Persist explicit grants/restrictions and add administration UI |
| Effective scope | Deterministic inherited descendant calculation is implemented; direct membership roots remain the only durable input | Add persisted grant/restrict rules and object-level scope tests |
| Temporal Namespace | Shared Namespace is documented as operational isolation only; organization-prefixed IDs and scoped commands remain the security boundary | Add dedicated Namespace/project deployment profiles when needed |
| Events + schedules | Coordinator handles events and a durable timer; outbox/dispatcher exists | Add source-specific Temporal Schedules/Cloud Scheduler wiring |
| Freshness | Typed freshness metadata is available on tool/graph/memory result boundaries; synthetic tools emit `fresh` | Add provider freshness budgets and stale-result policy in adapters/UI |
| Graph vs Memory | Separate deferred GraphStore and MemoryStore boundaries already exist | Implement scoped Spanner facts/provenance and hosted Memory Bank retrieval |
| Memory PII boundary | `regex-v1` redaction runs before distillation and again on returned memory records | Add provider-aware classification, retention, deletion, and export |
| Cloud Storage | Scoped in-memory artifact adapter records retention class | Add real GCS bytes, TTL/lifecycle, content/size limits, and IAM |
| Workflow failure reasons | Typed reason codes and waiting/degraded result fields are defined; missing local capabilities now return a durable waiting reason | Map Temporal/provider errors into persisted projections and UI |
| Runtime workers | Correct single Go Worker deployment model is already implemented | Scale worker replicas/queues only for load or isolation |

The addendum does not require a database-backed implementation before the next
synthetic vertical slice. It defines the boundaries now and leaves hosted
providers, migrations, and policy administration as explicit follow-up work.

## Requirement audit

| Original requirement | Current evidence | Status |
| --- | --- | --- |
| Generic Blueprint scenario | Typed route and Blueprint builder | Done |
| Minimal cross-language contracts | `packages/contracts`, JSON Schemas, shared Go validator, matching DTOs, artifact reference contract | Done for current boundary; generated DTOs and drift CI intentionally deferred |
| Typed endpoint aligned with Go | API command and `BlueprintWorkflowInput` | Done |
| Idempotency and active-workflow rules | Stable tenant Workflow ID, request fingerprint conflict, Temporal conflict policy, Postgres uniqueness, durable Signal/Update command receipts, concurrent API HTTP-route harness | Done for current slice; CI execution result and hosted concurrency verification pending |
| Authentication and organization scope | Conditional Identity Platform adapter and Postgres membership resolver | Done in code; hosted verification pending |
| Agent Gateway service auth and scope policy | Service token, local `401`/`403` smoke checks, Cloud Run audience support, non-empty scope and allowlist checks | Done for fixture policy; hosted IAM verification pending |
| Local end-to-end flow | `pnpm smoke:release` plus `pnpm smoke:approval` passed with local Temporal/Go processes | Done |
| Dashboard typed API integration | React Query client and workflow polling | Done for workflow screens |
| Workflow Creator plan boundary | `workflow-change-plan.v1`/`.v2`, explicit `start` intent, cancel-only Temporal plans, `coordinator-event.v1` with `workflowStarts`, Go bootstrap/reconciliation proposal Activities, Runtime-to-Gateway submit/start routes, Coordinator event receiver, transactional Gateway outbox, bounded dispatcher/sink, one-shot dispatcher entrypoint, API validation/submit/approve/apply routes, Blueprint registry persistence, audit | Partial; Cloud Run Job/Scheduler IAM and tenant scheduling, persistence-backed cancel verification, and DB migration hosted verification pending |
| Audit/logs/IDs/projection | Audit events, durable Signal/Update receipts, request/trace IDs, workflow/run IDs, read reconciliation | Partial; OpenTelemetry export/visibility consumer pending |
| Docker/health/Cloud Run configuration | Four Dockerfiles, health endpoints, Terraform env/secrets/IAM, Vertex AI ADC and Runtime control-plane wiring, CI smoke/persistence/container/Terraform jobs | Code and CI wiring complete; hosted CI image/provider validation pending |
| Hosted Google Cloud flow | No hosted smoke result yet | Pending external environment |
| Real provider integration | Synthetic Jira/GitHub fixtures only | Pending |
| Cloud Storage evidence | Canonical artifact request/result schemas, tenant-scoped artifact request, path validation, in-memory reference adapter | Partial; real GCS object writes, raw bytes, retention, size/content limits, and hosted IAM pending |
| Graph normalized facts | Versioned query/result contracts, scope/policy boundary, injectable deferred `GraphStore` | Partial; scope-aware Spanner implementation, normalized schema, provenance writes, and hosted IAM pending |
| Agent-specific Memory Bank | Versioned retrieve/distill contracts, scoped Go `memory.Store`, registered Activity with deferred store | Partial; Google Memory Bank adapter, retention/deletion, and hosted IAM pending |

## Remaining work, in order

### P0 — promote and harden the execution path

1. Keep the canonical JSON Schemas as the source of truth. Generated DTOs and a separate schema-drift generator are intentionally deferred while the cross-language boundary remains small; add them only when they reduce maintenance rather than adding another build system.
2. Observe the new CI `local-smoke` and `persistence` jobs. The former runs `pnpm smoke:release:local` with Agent Gateway `401`/`403` checks; the latter applies migrations and verifies RLS/receipt grants. Hosted CI results are still pending.
3. Let the new CI container and Terraform jobs build all four Dockerfiles and
   run provider-initialized `terraform validate`. Formatting passes locally,
   but the repository environment has no Docker daemon and the Google provider
   is not initialized here; do not run `terraform apply` from this review.
4. Run `pnpm smoke:release` against a hosted Temporal Cloud/Cloud Run
   deployment and record the revision, namespace, task queue, and run ID.

The local path proves the architecture; the next proof point is a hosted
synthetic run. It proves service identity, Cloud Run readiness, Temporal Cloud
connectivity, secrets, and task-queue configuration. If hosted credentials are
not available yet, continue with the persistence-backed tests and the CI
smoke/bootstrap work below; do not replace the hosted proof with a new local
workflow engine.
Do not block that proof on Graph, Memory Bank, real providers, or the native ADK
migration.

Hosted execution is intentionally an external step, not something to fake in
the repository. It requires a GCP project, Artifact Registry images, a
Temporal Cloud address/credential, Secret Manager values, Cloud SQL migrations,
an active Runtime service-user membership, and the Cloud Run service identities.
Without those values, only static Terraform formatting and local service
smoke can be verified safely; no `terraform apply`, provider API call, or real
company data ingestion should be attempted.

### P1 — complete the application boundary

5. Complete `workflow-change-plan.v2` application semantics. API route negotiation, registry update/deprecate behavior, explicit start intents, cancel-only Temporal cancellation, and mixed-target rejection are wired; add persistence-backed revision/cancel tests and hosted failure/retry verification. Do not overload one identifier with both meanings.
6. Complete the Coordinator control-plane lifecycle. Proposal generation, plan submission, the generic `coordinator-event.v1` receiver, transactional outbox enqueue, bounded dispatcher/sink, one-shot dispatch, and approved-snapshot start handoff are wired without Runtime database access. Add the Cloud Run Job/Cloud Scheduler deployment with per-tenant scheduling and IAM, pending-plan reconciliation, and persistence-backed service-user authorization tests.
7. Harden Signal/Update handling for waiting and approval states with replay protection and explicit workflow-state checks. Approval Signals and the generic `blueprint-context` Update now pass a real local API → Temporal → Go resume smoke with required IDs, terminal-state rejection, actor/role authorization, Postgres audit events, and tenant-scoped durable command receipts. CI now verifies the migration, RLS, uniqueness index, grants, DB-level duplicate insert race, and the concurrent full HTTP-route Update harness against ephemeral Postgres; observe the CI result and extend coverage to additional command types. Broader Update types remain pending.
8. Replace the current API read/list projection sync with a dedicated Temporal visibility/event consumer; API reads now reconcile status, run ID, timestamps, and status-change audit events, while push-based updates are still pending.
9. Expand the MCP-shaped catalog with persisted manifests, connector grants, and live provider adapters. The canonical `tool-manifest.v1` schema, fixture catalog metadata, manifest validation, and per-tool scope checks are now implemented; persistence, grants, discovery, and live adapters remain pending.
10. Add OpenTelemetry export and span instrumentation across API → Temporal → Runtime → Agent Gateway, then replace the dashboard's remaining static overview cards with API projections. Keep onboarding localStorage only for onboarding UX until its own API is available; it is not workflow state.
11. Run a focused Temporal Go `googleadk` migration spike for one agent step after the hosted synthetic smoke and lifecycle contract decision. Pin the candidate module and its required SDK/ADK versions in the spike only. Compare Activity-level retries with Workflow-level ADK loop execution, history size, human approval/resume behavior, deterministic function tools, `ActivityAsTool`, and MCP tool dispatch. Keep the current Activity path as the fallback until the spike passes; do not migrate the whole Blueprint interpreter in the spike.

### P2 — deploy and connect providers

12. Validate the hosted Cloud Run service-identity path as part of the
    synthetic deployment: the Go client supports a Google ID token audience
    plus a separate Encois service token; capture service, revision, task
    queue, and Temporal namespace configuration.
13. Connect one real read-only integration, preferably Jira, with Secret
    Manager credentials, provider timeouts, recorded fixtures, and evidence
    references; add GitHub afterwards. The adapter must normalize provider data
    behind the existing `jira.project_tasks` capability, enforce the execution
    scope before the request, and never expose provider tokens or raw responses
    to Temporal history.
14. Replace the in-memory `ArtifactStore` with Cloud Storage raw evidence and
    artifact references. Store large provider responses under tenant/workflow-
    scoped keys, return only immutable evidence references to the Runtime, and
    add retention/content-type/size limits before enabling it in a hosted
    environment.
15. Add Spanner Graph normalized facts and relationships. The typed
    `GraphStore` boundary is now present, but the default adapter remains
    deferred and the fixture policy does not grant graph reads. Start with a
    small schema for organization, team, project, release, issue, pull request,
    and person/system edges; keep provenance and observed timestamps, and make
    every query organization/scope constrained.
16. Add Memory Bank selective agent-specific memory. The typed Runtime
    boundary and Activity now exist, but the default store remains
    deferred. Add the provider call inside that Temporal Activity and persist only distilled,
    non-secret agent context with organization/project/agent scope, source
    references, freshness, and deletion behavior; do not use Memory Bank as
    the canonical workflow or company graph store.

## Explicitly defer

Do not build a custom Firestore workflow engine, one microservice per specialist or
repository, Graph-first retrieval, Memory Bank-first product logic, or arbitrary
MCP discovery during a running execution. The next proof point is the generic
Blueprint flow with synthetic tools.

## Vertical-slice done condition

An authenticated user can start or reuse one generic Blueprint execution, see a
durable workflow status, execute two synthetic read-only tools in parallel,
receive a structured evidence-linked result, resume an approved wait through a
Signal, and observe a denied request when service auth, scope, or tool
capability is invalid. The same contract passes through TypeScript, Temporal,
Go, and Agent Gateway without direct Go access to control-plane Postgres.
