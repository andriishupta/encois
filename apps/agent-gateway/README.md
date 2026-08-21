# Encois Agent Gateway

The private Go policy and tool broker for the Agent Runtime. It is the final
internal boundary before provider, graph, and artifact access.

Knowledge Source registration and revision metadata belong to the Gateway API
control plane. This service remains the Runtime-facing data-plane boundary for
source acquisition, provider tools, raw artifact access, and future Graph
projection; it is not a second Source registry.

The current implementation provides the HTTP boundary, service authentication,
a deterministic read-only fixture policy, and selectable mock/GCP data-plane
adapters. Local mode is process-local; GCP mode uses Cloud Storage and Spanner
through Application Default Credentials.

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
- `POST /v1/tools/invoke` — mock `jira.project_tasks` and
  `github.project_activity` tools;
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
- `POST /v1/workflows/validate` — validates a user blueprint and derives its
  permission requirements;
- `POST /v1/workflows` — MVP in-memory blueprint registration;
- `GET /v1/workflows/:workflowId` — reads a registered blueprint.

The workflow endpoints are an internal validation/registration scaffold. They
do not start Temporal and do not persist production state. The API Gateway
remains the authoritative owner of user-facing workflow persistence,
authorization grants, idempotency, and Temporal start/signal/schedule calls.
The Agent Gateway derives required permissions from the step/tool catalog and
checks them through the current policy service. The current policy allows only
the two synthetic read-only project tools and denies unknown tools or
incomplete execution context. Tool invocation also checks that the execution
scope satisfies the capability's required scope. The catalog is fixture-level;
persisted connector grants, live MCP/API manifests, and real provider adapters
are deferred.

The following provider-facing pieces remain future work:

- resolve scoped provider credentials through managed secret storage;
- route allowlisted live provider or MCP calls;
- connector grants, live provider/MCP discovery, and non-fixture provider calls;
- retention/deletion verification and production operational policies for the
  hosted adapters.

Set `AGENT_GATEWAY_DATA_MODE=mock` explicitly for local/test development. The
default is `gcp`; set it with `GCP_STORAGE_BUCKET` and `SPANNER_DATABASE` to
activate the hosted adapters.
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
The current mock tools are deliberately read-only and return synthetic data.
The local multi-process smoke also verifies that missing service authentication
returns `401` and an unknown tool returns `403` before the positive workflow
path is started.

## Dependencies

- `cloud.google.com/go/storage` — organization-scoped raw payloads and large
  artifacts;
- `cloud.google.com/go/spanner` — normalized company context and graph-backed
  data access.

Temporal and Google ADK dependencies belong to `apps/agent-runtime`, not this
policy boundary.
