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

Application routes are mounted under `/api/v1`. Protected routes use the AOS middleware. AOS is intentionally fail-closed while its issuer and claims contract are undecided; inject an authenticator in `createApp` when the contract is available.

Current blueprint routes:

- `GET /api/v1/integrations` — list integrations visible to the authenticated user's organization scope.
- `POST /api/v1/integrations/:integrationId` — update an integration after object-level authorization.
- `POST /api/v1/workflows` — start a workflow through Temporal (or the local in-memory adapter).
- `GET /api/v1/workflows/:workflowId` — read a tenant-authorized workflow projection.

When `TEMPORAL_ADDRESS` is empty, workflow calls use the in-memory adapter so the API can be developed without Temporal credentials. Set `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, and either `TEMPORAL_API_KEY` or mTLS settings to switch to Temporal Cloud. The API starts executions; the Go runtime owns the workers that poll the task queue.

Identity Platform verification is available through `src/auth/identity-platform.ts`. It uses Firebase Admin SDK + Application Default Credentials, so Cloud Run can use its service identity without a checked-in key. The resolver that maps an external subject to an organization membership is intentionally injected and must use the persistence package.

Cloud SQL access is owned by `@encois/persistence`. Use `DATABASE_RUNTIME_URL` for the API and `DATABASE_MIGRATION_URL` only for migrations; never point the API at the Cloud SQL admin connection.

## Layout

Each feature owns its router, routes, and services:

```text
src/
  api/v1/router.ts
  integrations/{router.ts,routes/,services/}
  workflows/{router.ts,routes/,services/,temporal-client.ts,types.ts}
  webhooks/{router.ts,routes/,services/}
  health/router.ts
  middleware/{aos.ts,error-handler.ts,request-logging.ts}
  auth/identity-platform.ts
  app.ts
  config.ts
  server.ts
```
