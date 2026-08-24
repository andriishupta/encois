# Encois Agent Gateway

The private Go policy and tool broker for the Agent Runtime. It is the final
internal boundary before provider, graph, and artifact access.

Source registration and revision metadata belong to the Gateway API
control plane. This service remains the Runtime-facing data-plane boundary for
source acquisition, provider tools, raw artifact access, and future Graph
projection; it is not a second Source registry.

The current implementation provides the HTTP boundary, service authentication,
a deterministic read-only policy, and selectable mock/GCP data-plane adapters.
Local mode is process-local; GCP mode uses Cloud Storage, Spanner, Secret
Manager, and typed read-only GitHub/Jira provider adapters through Application
Default Credentials.

When `INTEGRATION_OAUTH_CONFIG_JSON` is supplied from Secret Manager, the
Gateway can refresh provider OAuth tokens on expiry or one provider
authorization failure, write a new secret version, and retry once. Providers
without a configured refresh token fail closed with `needs_reauth`; raw
credentials never enter API responses or logs.

`POST /v1/provider-health/check` is a service-authenticated, read-only probe
for one scoped GitHub or Jira integration. It requires `X-Organization-ID`, an
`integrationId`, and a provider; the Gateway reads the Secret Manager
credential, calls the provider's identity endpoint, and reports `active`,
`degraded`, or `needs_reauth` through the control-plane health callback.

## Run

From this directory:

```bash
AGENT_GATEWAY_DATA_MODE=mock go run ./cmd/agent-gateway
```

Default address: `http://127.0.0.1:8080`.

Set `AGENT_GATEWAY_SERVICE_TOKEN` in both the Gateway and Agent Runtime
environments. Health endpoints remain public; all `/v1/*` routes require the
Runtime service credential. For Cloud Run, the Runtime may additionally send a
Google ID token for the Gateway audience; the Encois service token remains a
separate application-level check. Set the same high-entropy
`AGENT_GATEWAY_CAPABILITY_SECRET` in the Gateway API and Agent Gateway; every
internal execution request must carry a signed capability bound to its exact
organization, workflow, actor, policy version, and scope. Missing service or
capability configuration makes readiness fail closed.

Endpoints:

- `GET /health/live` and `GET /health/ready` — service and dependency status;
- `POST /v1/authorize` or `/v1/permissions/check` — deterministic fixture policy decision;
- `GET /v1/tools` — MCP-shaped registered tool catalog with versions, schemas,
  annotations, availability, approval metadata, and required scope;
- `POST /v1/tools/invoke` — hosted read-only GitHub/Jira adapters in GCP mode,
  deterministic fixtures in explicit mock mode;
- `POST /v1/graph/query` — typed, scope-constrained Spanner Graph boundary;
  supports named logical queries against the mock or Spanner-backed node/edge
  projection;
- `POST /v1/graph/upsert` — internal normalized fact/provenance projection;
- `POST /v1/artifacts` — tenant-scoped artifact reference boundary; currently
  backed by the selected mock or Cloud Storage adapter;
- `POST /v1/artifacts/read` — internal scoped raw artifact read used by source
  ingestion;
- `GET /v1/workflow-capabilities` — registered builder capabilities and the
  generic Temporal workflow type;
- `POST /v1/workflows/validate` — validates a user-created Blueprint and derives its
  permission requirements;
- `POST /v1/workflows` — MVP in-memory blueprint registration;
- `GET /v1/workflows/:workflowId` — reads a registered blueprint.

The workflow endpoints are an internal validation/registration scaffold. They
do not start Temporal and do not persist production state. The API Gateway
remains the authoritative owner of user-facing workflow persistence,
authorization grants, idempotency, and Temporal start/signal/schedule calls.
The Agent Gateway derives required permissions from the step/tool catalog and
checks them through the current policy service. Hosted tool invocation resolves
the active, scope-visible integration through the private API boundary, reads
only its Secret Manager reference, and calls an allowlisted provider endpoint.
Unknown tools, missing grants, invalid credentials, and provider errors fail
closed; raw credentials never enter the browser, model context, or Temporal
history.
Provider adapter success/failure is also reported to the private control plane,
which updates Integration lifecycle state (`active`, `degraded`, or
`needs_reauth`) and writes an audit event; the dashboard never infers provider
health locally.

Set `AGENT_GATEWAY_DATA_MODE=mock` explicitly for local/test development. The
default is `gcp`; set it with `GCP_STORAGE_BUCKET` and `SPANNER_DATABASE` to
activate the hosted adapters. Mock mode uses memory stores by default; set
`AGENT_GATEWAY_STORAGE_MODE=gcs` with `STORAGE_EMULATOR_HOST` to read raw
Source artifacts from a local GCS-compatible emulator while keeping Graph and
provider adapters mocked. GCP mode also requires `GOOGLE_CLOUD_PROJECT`,
`CONTROL_PLANE_URL`, `CONTROL_PLANE_AUDIENCE`, and
`CONTROL_PLANE_SERVICE_TOKEN` for provider credential resolution.
The Spanner database must contain the tables from `infra/spanner-schema.sql`.

The current policy already validates execution context, policy version, scope,
and the read-only tool allowlist. A revision without service authentication or
execution-capability signing must not receive traffic: readiness fails with
`503` when `AGENT_GATEWAY_SERVICE_TOKEN` or `AGENT_GATEWAY_CAPABILITY_SECRET`
is missing.

The gateway is an internal east-west boundary. Its tool catalog and invocation
payloads follow the MCP shape, wrapped in an Encois execution context. It must
not be browser-facing, an unrestricted HTTP fetcher, or a replacement for
Temporal workflow state.
The current mock tools and storage/graph adapters are deliberately scoped to
the data-plane boundary and return synthetic provider/infrastructure data only;
they are available only when the explicit mock data mode is selected. They do
not create product users, permissions, onboarding state, workflow identity, or
Run truth.
The local multi-process smoke also verifies that missing service authentication
returns `401` and an unknown tool returns `403` before the positive workflow
path is started.

## Dependencies

- `cloud.google.com/go/storage` — organization-scoped raw payloads and large
  artifacts;
- `cloud.google.com/go/spanner` — normalized company context and graph-backed
  data access.
- `google.golang.org/api/secretmanager/v1` — scoped provider credential access;
  provider tokens are never returned in tool results.

Temporal and Google ADK dependencies belong to `apps/agent-runtime`, not this
policy boundary.
