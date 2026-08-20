# Encois Agent Gateway

The private Go policy and tool broker for the Agent Runtime. It is the final
internal boundary before provider, graph, and artifact access.

The current skeleton provides the HTTP boundary and an explicitly temporary
allow-all policy. Real auth, policy, Spanner, Storage, and provider adapters are
still deferred.

## Run

From this directory:

```bash
go run ./cmd/agent-gateway
```

Default address: `http://127.0.0.1:8080`.

Endpoints:

- `GET /health/live` and `GET /health/ready` — service and dependency status;
- `POST /v1/authorize` or `/v1/permissions/check` — MVP allow-all decision;
- `GET /v1/tools` — registered tool blueprint;
- `POST /v1/tools/invoke` — mock `jira.release_tasks` and
  `github.release_activity` tools;
- `POST /v1/graph/query` — reserved Spanner Graph boundary;
- `POST /v1/artifacts` — reserved Cloud Storage boundary.
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
checks them through the current policy service; the current result is
`mvp-allow-all`.

Future gateway code will:

- authenticate the Agent Runtime service identity;
- validate registered tools, organization scope, execution context, and
  policy version;
- resolve scoped provider credentials through managed secret storage;
- route only allowlisted provider or MCP calls;
- persist large raw responses and artifacts in Cloud Storage; and
- read or write normalized, authorized company context through Spanner.

The gateway is an internal east-west boundary. It must not be browser-facing,
an unrestricted HTTP fetcher, or a replacement for Temporal workflow state.
The current mock tools are deliberately read-only and return synthetic data.

## Dependencies

- `cloud.google.com/go/storage` — organization-scoped raw payloads and large
  artifacts;
- `cloud.google.com/go/spanner` — normalized company context and graph-backed
  data access.

Temporal and Google ADK dependencies belong to `apps/agent-runtime`, not this
policy boundary.
