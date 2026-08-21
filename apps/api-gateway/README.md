# Encois API Gateway

The public TypeScript/Hono Gateway API. It is the north-south application boundary for authentication, organization scope, registry operations, workflow control, and UI projections.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter @encois/api-gateway dev
```

The default local server listens on `http://127.0.0.1:8787`.

Public endpoints:

- `GET /health/live` — liveness check.
- `GET /health/ready` — readiness check for the current scaffold.
- `GET /` — service metadata.

Application routes are mounted under `/api/v1`. Protected routes use the AOS middleware. When `IDENTITY_PLATFORM_PROJECT_ID` and the runtime database are configured, `createApp` wires the Firebase Admin Identity Platform verifier and resolves local membership/scope. Tests and local scaffolds can still inject an authenticator.

Current blueprint routes:

- `GET /api/v1/integrations` — list integrations visible to the authenticated user's organization scope.
- `POST /api/v1/integrations/:integrationId` — update an integration after object-level authorization.
- `POST /api/v1/workflows` — start a workflow through Temporal (or the local in-memory adapter).
- `GET /api/v1/workflows` — list tenant-visible workflow projections.
- `POST /api/v1/workflows/release-investigations` — typed `release-investigation.v1` start/reuse endpoint.
- `POST /api/v1/workflows/plans/validate` — validate a typed `workflow-change-plan.v1` create proposal or `workflow-change-plan.v2` lifecycle proposal without applying it.
- `POST /api/v1/workflows/plans` — persist an idempotent v1/v2 proposal as `proposed` when Postgres is configured.
- `POST /api/v1/workflows/plans/:planId/approve` — approve a persisted proposal; application is still a separate step.
- `POST /api/v1/workflows/plans/:planId/apply` — apply an approved v1 `create`, v2 Blueprint `update`, or v2 Blueprint `deprecate` proposal and enqueue its Coordinator event; only an explicit `start` intent launches the approved Blueprint snapshot. v2 Temporal `cancel` remains explicitly unsupported until a Temporal cancellation client is wired.
- `POST /api/v1/internal/coordinator/plans/validate` — private Runtime/Coordinator plan preview; requires `X-Encois-Service-Token` and `X-Organization-ID`.
- `POST /api/v1/internal/coordinator/plans` — private Runtime/Coordinator plan submission; the human approval boundary remains in the Gateway.
- `POST /api/v1/internal/coordinator/workflows` — private start path for an approved tenant Blueprint reference; it reuses the generic workflow service and does not expose the database.
- `GET /api/v1/workflows/:workflowId` — read a tenant-authorized workflow projection.
- `POST /api/v1/workflows/:workflowId/signals` — send an authorized approval Signal.
- `POST /api/v1/workflows/:workflowId/updates` — apply an authorized context Update to an active workflow.

When `TEMPORAL_ADDRESS` is empty, workflow calls use the in-memory adapter so the API can be developed without Temporal credentials. Set `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, and either `TEMPORAL_API_KEY` or mTLS settings to switch to Temporal Cloud. The API starts executions; the Go runtime owns the workers that poll the task queue.

`AGENT_GATEWAY_POLICY_VERSION` must match the policy version configured in the
private Agent Gateway; it is propagated through the generic workflow input and
checked again for every tool invocation.

The private Coordinator routes use `CONTROL_PLANE_SERVICE_TOKEN` for the local
service boundary. In a database-backed deployment they also require
`CONTROL_PLANE_SERVICE_USER_ID` to resolve an active tenant membership and its
scopes. Cloud Run platform identity can be added alongside this application
token at the deployment boundary.

`dist/coordinator-dispatcher.js` is an optional one-shot process for delivering
the tenant-scoped Coordinator outbox to Temporal. Run it locally with
`COORDINATOR_DISPATCH_ORGANIZATION_ID=org-test pnpm dispatch:coordinator`, or
use the same API image as a Cloud Run Job invoked by Cloud Scheduler. The
dispatcher is not an HTTP route: the scheduler must provide one organization
per invocation and use a service identity with only the required job/runtime
permissions.

Identity Platform verification is available through `src/auth/identity-platform.ts`. It uses Firebase Admin SDK + Application Default Credentials, so Cloud Run can use its service identity without a checked-in key. The resolver that maps an external subject to an organization membership is intentionally injected and must use the persistence package.

Cloud SQL access is owned by `@encois/persistence`. Use `DATABASE_RUNTIME_URL` for the API and `DATABASE_MIGRATION_URL` only for migrations; never point the API at the Cloud SQL admin connection.

## Layout

Each feature owns its router, routes, and services:

```text
src/
  app.ts                 active API version and version router
  integrations/{router.ts,routes/,services/}
  workflows/{router.ts,routes/,services/,temporal-client.ts,types.ts}
  webhooks/{router.ts,routes/}
  health/router.ts
  database.ts
  middleware/{aos.ts,error-handler.ts,request-logging.ts}
  auth/identity-platform.ts
  config.ts
  server.ts
```
