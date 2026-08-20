# Current Review and Next Steps

**Reviewed:** 2026-08-20  
**Scope:** repository state after the generic Workflow Blueprint and Go Agent Runtime changes

## Current state

- The repository has a React SPA, TypeScript Gateway API, Go Agent Runtime, and private Go Agent Gateway scaffold.
- The Runtime registers `CoordinatorWorkflow`, `BootstrapProjectWorkflow`, and the generic `encois.user-blueprint.v1` Workflow. Provider-specific Temporal Workflow types are not part of the current design.
- The generic interpreter handles dependency ordering, parallel ready steps, tool/agent Activities, deterministic transform/condition steps, wait timers, and approval Signals.
- The Agent Gateway has synthetic read-only Jira/GitHub fixtures and an explicitly temporary allow-all policy.
- TypeScript typecheck/tests and Go tests/vet pass locally.
- `packages/contracts` does not exist yet; TypeScript and Go still have duplicated local DTOs.
- Graph, Memory Bank, Cloud Storage adapters, real provider APIs, and production authentication are not connected to the vertical slice.

## Priority order

### P0 — make one safe generic execution path

1. Create `packages/contracts` with versioned OpenAPI/JSON Schema for Blueprint, workflow start/result, execution context, tool manifest, tool invocation/result, and Signals.
2. Add a separate validated business `input` to the Blueprint execution payload. Pass the authoritative organization scope, actor, workflow ID, and policy version into every Activity and Agent Gateway request.
3. Implement and test the real path: Gateway API → Temporal Cloud/local Temporal → Go generic Workflow → Agent Gateway fixture → workflow result/projection.
4. Replace the current gateway-client defaults with bounded HTTP timeouts and authenticated Runtime-to-Agent-Gateway service calls. Require workflow ID, actor ID, scope, and policy version at the gateway boundary.
5. Replace `mvp-allow-all` with a deterministic minimum policy for the synthetic read-only tools. Deny unknown tools, missing grants, cross-tenant scope, and write-like capabilities.

### P1 — make the protocol usable

6. Return MCP-shaped manifests with input/output JSON Schemas, annotations, versions, and required capabilities; keep the fixture providers behind that catalog.
7. Add schema validation at API, Runtime, and Agent Gateway boundaries, plus contract tests across TypeScript and Go.
8. Add API Signal/Update routes for approval and waiting states, idempotent start/reuse behavior, and workflow status projection updates.
9. Wire the real Identity Platform adapter and organization membership/scope enforcement before connecting customer data.

### P2 — deploy and connect providers

10. Align Terraform and Go runtime environment names, add worker readiness/health behavior or choose a worker-appropriate deployment, then add Dockerfiles and a repeatable Cloud Run/Temporal deployment.
11. Connect one real read-only integration, preferably Jira or GitHub, with Secret Manager credentials, recorded fixtures, provider timeouts, and evidence references.
12. Add Cloud Storage evidence/artifacts, then Graph facts and Memory Bank distillations as separate projections of the same validated evidence.

## Explicitly defer

Do not build a custom Firestore workflow engine, one microservice per specialist or
repository, Graph-first retrieval, Memory Bank-first product logic, or arbitrary
MCP discovery during a running execution. First prove the generic contract and
one safe end-to-end run.

## Vertical-slice done condition

An authenticated user can start or reuse one company Blueprint, see a durable
workflow status, execute two synthetic read-only tools in parallel, receive a
structured evidence-linked result, and observe a denied request when scope or
tool capability is invalid. The same contract must pass through TypeScript,
Temporal, Go, and Agent Gateway without direct Go access to the control-plane
Postgres database.
