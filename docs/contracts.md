# Encois Contracts and Cross-Language Boundaries

**Status:** proposed MVP convention

This document defines how the TypeScript control plane, Go Agent Runtime, private Agent Gateway, React SPA, and integrations exchange data. The goal is to share stable contracts, not source code or database implementations.

## Contract ownership

| Boundary | Source of truth | Generated consumers |
|---|---|---|
| Browser and public HTTP API | OpenAPI document | React client and TypeScript API validators/types |
| Temporal inputs, Signals, and results | Versioned JSON Schema | TypeScript Gateway API and Go Runtime |
| Private Agent Gateway | Versioned JSON Schema initially | Go Runtime and private gateway |
| Integration manifests and evidence events | Versioned JSON Schema | registry, adapters, graph/memory pipeline |
| Control-plane persistence | SQL migrations owned by Gateway API | Gateway API only |

OpenAPI is the right first choice for the public API because it describes routes, errors, authentication requirements, pagination, and generated clients. JSON Schema is the right first choice for payloads that cross the Temporal and internal-service boundaries. Use authenticated internal HTTP/JSON for the MVP Agent Gateway. Do not make the Go worker import TypeScript files, and do not make the API expose database or provider SDK types.

## Suggested repository layout

```text
packages/contracts/
  openapi.yaml
  schemas/
    temporal/
      release-investigation.v1.json
      investigation-signal.v1.json
    agent-gateway/
      tool-request.v1.json
      tool-result.v1.json
      execution-context.v1.json
    integrations/
      manifest.v1.json
      evidence-event.v1.json
  generated/
    typescript/

apps/agent-runtime/internal/contracts/generated/
apps/agent-gateway/internal/contracts/generated/
```

The schemas are edited as the source. Generated TypeScript and Go files are build artifacts or checked-in outputs according to the repository's generation policy; neither language becomes the schema owner.

## Public Gateway API

The OpenAPI surface should describe application capabilities, not infrastructure details. Initial examples:

```text
POST /v1/investigations/release-risk
GET  /v1/investigations/{investigationId}
GET  /v1/investigations/{investigationId}/events
POST /v1/investigations/{investigationId}/signals
GET  /v1/graph/query
GET  /v1/agents
GET  /v1/integrations
```

The API validates requests at the boundary, computes organization scope, applies idempotency, and calls the Temporal client. The browser receives a stable investigation projection. It never receives Temporal credentials, provider credentials, raw unrestricted payloads, or internal service addresses.

## Temporal payloads

Temporal receives small versioned objects. A release investigation input can look like:

```json
{
  "contractVersion": "release-investigation.v1",
  "requestId": "req_123",
  "organizationId": "acme",
  "actorId": "user-123",
  "scope": {
    "teamIds": ["platform"],
    "projectIds": ["checkout"]
  },
  "releaseId": "release-aug-30",
  "policyVersion": "policy-17"
}
```

The object contains IDs and authorization context, not the contents of Jira tickets or GitHub repositories. Activities return references such as:

```json
{
  "contractVersion": "evidence-batch-ref.v1",
  "batchId": "evidence_456",
  "source": "jira",
  "rawObjectKey": "org/acme/runs/run_789/jira/batch_456.json",
  "graphFactIds": ["fact_1", "fact_2"],
  "observedAt": "2026-08-19T09:30:00Z"
}
```

Temporal history should remain small, replayable, and safe to inspect. Large results belong in Cloud Storage or a purpose-built data store, with only a reference in the Workflow.

## Coordinator and workflow blueprint payloads

Onboarding creates one logical Coordinator Workflow for the organization or
project scope. Its input and Signals contain identifiers and state, not raw
provider data:

```json
{
  "contractVersion": "coordinator-start.v1",
  "coordinatorId": "coord_acme_checkout",
  "organizationId": "acme",
  "projectId": "checkout",
  "scopeType": "project",
  "policyVersion": "policy-17",
  "state": {
    "status": "ONBOARDING",
    "version": 0,
    "onboardingComplete": false,
    "reconciliationCount": 0
  }
}
```

The Workflow Creator returns a typed proposal that is validated against the
Agent Registry and approved blueprint catalog before the Gateway API persists
or starts anything:

```json
{
  "contractVersion": "workflow-change-plan.v1",
  "planId": "plan_123",
  "coordinatorId": "coord_acme_checkout",
  "organizationId": "acme",
  "projectId": "checkout",
  "changes": [
    {
      "kind": "create",
      "blueprint": {
        "contractVersion": "workflow-blueprint.v1",
        "blueprintId": "release-risk",
        "version": "1.0.0",
        "name": "Release risk",
        "workflowType": "ReleaseRiskWorkflow",
        "purpose": "Investigate release readiness",
        "enabled": true,
        "steps": [
          {
            "id": "jira",
            "kind": "tool",
            "tool": "jira.release_tasks"
          },
          {
            "id": "github",
            "kind": "tool",
            "tool": "github.release_activity"
          }
        ],
        "requiredScopes": ["project:checkout"],
        "allowedTools": ["jira.release_tasks", "github.release_activity"],
        "requiresApproval": false
      },
      "reason": "Initial project bootstrap",
      "requiresApproval": false
    }
  ]
}
```

Gemini may propose this object, but it cannot approve it. Temporal can start
only workflow types already registered by a Worker; a blueprint selects and
configures executable code rather than generating new Go code at runtime.

## Private Agent Gateway

The Agent Runtime sends a request like:

```json
{
  "contractVersion": "tool-request.v1",
  "requestId": "req_123",
  "workflowId": "release-risk:acme:release-aug-30",
  "organizationId": "acme",
  "actorId": "user-123",
  "scope": { "teamIds": ["platform"] },
  "agentDefinition": "github-specialist@1",
  "tool": "github.search_pull_requests",
  "input": { "repository": "checkout-api", "state": "open" },
  "policyVersion": "policy-17"
}
```

The private gateway then validates the registered tool, checks the effective scope and current policy, resolves a short-lived connector credential, calls the provider API or MCP server, validates the response, stores raw data when required, and returns normalized data plus references. It does not accept authority from model output. A disabled pack or revoked scope returns a typed policy error rather than an arbitrary provider error.

The initial internal HTTP surface is:

```text
POST /v1/authorize or /v1/permissions/check
GET  /v1/tools
POST /v1/tools/invoke
POST /v1/graph/query
POST /v1/artifacts
```

The first two tool fixtures are `jira.release_tasks` and
`github.release_activity`. They are synthetic and read-only; the graph and
artifact routes remain reserved boundaries until their adapters are added.

## Compatibility rules

- Every cross-language payload has a contract version.
- Additive fields are optional first; removing or changing field meaning requires a new major version.
- Consumers must reject unknown contract versions and tolerate unknown optional fields.
- IDs, timestamps, scopes, status values, and error codes use explicit formats and enums.
- Validate JSON at both sides of a trust boundary; TypeScript should validate with the selected schema library and Go should decode strictly and validate required fields.
- Error responses include a stable code, human-safe message, request ID, and retryability classification. They do not include tokens, raw provider payloads, or hidden model reasoning.
- Provider-specific fields stay inside the provider adapter. Normalized evidence and graph facts cross the boundary instead.

## What is deliberately not shared

- Postgres/Drizzle models are owned by the Gateway API. The Go Runtime does not connect to the control-plane database.
- Temporal Workflow implementation code is owned by the Go Runtime. The TypeScript API only uses the Temporal client and generated input/signal types.
- Google ADK, Temporal Go SDK, provider SDKs, and MCP client objects are implementation details of the runtime/gateway.
- Secrets, OAuth tokens, raw unrestricted company data, and chain-of-thought never cross as general-purpose DTOs.

If internal service count or performance later requires a strongly typed binary protocol, introduce protobuf and Buf for the Agent Gateway. That is an optimization after the JSON contracts have stabilized, not an MVP prerequisite.
