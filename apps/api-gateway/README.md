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

Invite-only access routes are intentionally outside the active-membership
middleware:

- `GET /api/v1/auth/me` — verifies the Identity Platform bearer token and
  returns `active` or `pending`; it never grants access from token claims alone.
- `POST /api/v1/public/waitlist` — accepts a bounded contact request without
  authentication. It requires a plausible work email, company name, and
  company website or LinkedIn URL; it does not create an Identity Platform
  account or local membership.

The production browser flow enables only Google sign-in. A verified email must
match a non-expired `organization_invites` row before the Gateway transaction
creates the local user, membership, and organization-unit scope. There is no
email/password signup or self-service organization creation.

The local Compose flow sets `FIREBASE_AUTH_EMULATOR_HOST`, allows the emulator's
`password` provider, and uses `src/local-seed.ts` to create a verified local
Firebase account plus a pending organization invite. It does not create the
Encois `users` row ahead of time; the normal `/api/v1/auth/me` provisioning path
does that after local login.

Current blueprint routes:

- `GET /api/v1/integrations` — list integrations visible to the authenticated user's organization scope.
- `POST /api/v1/integrations/:integrationId` — update an integration after object-level authorization.
- `GET /api/v1/sources` — list scoped Knowledge Sources.
- `POST /api/v1/sources` — register an integration, uploaded-document, manual, or media Source.
- `POST /api/v1/sources/uploads` — upload a validated PDF (up to 10 MiB) as a new source and immutable revision; production requires `SOURCE_ARTIFACT_BUCKET`.
- `GET /api/v1/sources/:sourceId` — read a Source and its immutable revisions.
- `POST /api/v1/sources/:sourceId/revisions` — register a revision by artifact/provider reference; raw bytes are not stored in Postgres or Temporal.
- `POST /api/v1/sources/:sourceId/revisions/:revisionId/ingest` — start the platform-owned `encois.source-ingestion.v1` Workflow.
- `GET /api/v1/organization` — return the caller-visible organization, units, members, and direct membership permissions.
- `GET /api/v1/organization/units` — list organization units visible to the caller.
- `POST /api/v1/organization/units` — create a child unit inside an administrator or manager scope.
- `GET /api/v1/organization/members` — list members visible to the caller's management scope.
- `GET /api/v1/organization/permissions` — list direct membership scopes the caller can administer.
- `POST /api/v1/organization/permissions` — create or update a direct membership scope.
- `PATCH /api/v1/organization/permissions/:permissionId` — change a direct scope's access level.
- `DELETE /api/v1/organization/permissions/:permissionId` — remove a direct scope; the Gateway writes an audit event.
- `POST /api/v1/workflows` — start a workflow through Temporal (or the explicitly selected development/test in-memory adapter).
- `GET /api/v1/workflows` — list tenant-visible workflow projections.
- `POST /api/v1/workflows` — generic Blueprint start/reuse endpoint.
- `GET /api/v1/workflows/templates` — return up to 10 published, tenant-visible provider-neutral workflow templates; supports `q`, `category`, and `limit`.
- `POST /api/v1/workflows/plans/validate` — validate a typed `workflow-change-plan.v1` lifecycle proposal without applying it.
- `POST /api/v1/workflows/plans` — persist an idempotent v1 proposal as `proposed` when Postgres is configured.
- `POST /api/v1/workflows/plans/:planId/approve` — approve a persisted proposal; application is still a separate step.
- `POST /api/v1/workflows/plans/:planId/apply` — apply an approved v1 `create`, Blueprint `update`/`deprecate`, or cancel-only proposal and enqueue its Coordinator event; only an explicit `start` intent launches the approved Blueprint snapshot.
- `POST /api/v1/internal/coordinator/plans/validate` — private Runtime/Coordinator plan preview; requires `X-Encois-Service-Token` and `X-Organization-ID`.
- `POST /api/v1/internal/coordinator/plans` — private Runtime/Coordinator plan submission; the human approval boundary remains in the Gateway.
- `POST /api/v1/internal/coordinator/workflows` — private start path for an approved tenant Blueprint reference; it reuses the generic workflow service and does not expose the database.
- `GET /api/v1/workflows/:workflowId` — read a tenant-authorized workflow projection.
- `POST /api/v1/workflows/:workflowId/signals` — send an authorized approval Signal.
- `POST /api/v1/workflows/:workflowId/updates` — apply an authorized context Update to an active workflow.

Workflow Templates are stored in the Gateway control plane as searchable
metadata plus immutable JSONB versions. They use logical capabilities and
provider slots, so a template can resolve to GitHub or GitLab, Jira or Linear,
and Slack or Teams. Workflow Creator later maps a selected template to a
validated tenant Blueprint; the Go Runtime does not read this catalog.
Knowledge Sources are a separate control-plane model. Templates do not create
Sources, revisions, or ingestion runs.

The in-memory workflow adapter is available only in development/test or when
`ENCOIS_WORKFLOW_MODE=memory` is explicitly selected. Production and
production-like Compose require `ENCOIS_WORKFLOW_MODE=temporal`,
`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, and either
`TEMPORAL_API_KEY` or mTLS settings; the API fails closed instead of silently
falling back to memory. The API starts executions; the Go runtime owns the
workers that poll the task queue.

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

Operator lifecycle scripts use `DATABASE_MIGRATION_URL`:

```bash
pnpm --filter @encois/api-gateway auth:bootstrap-organization -- --organization "Example Company" --email owner@example.com
pnpm --filter @encois/api-gateway auth:invite-user -- --organization-id <organization-id> --email member@example.com
pnpm --filter @encois/api-gateway auth:list-waitlist
pnpm --filter @encois/api-gateway auth:revoke-invite -- --invite-id <invite-id>
```

They are private operator tooling and intentionally do not create provider
accounts. The first invited user accepts access by completing Google login.

Cloud SQL access is owned by `@encois/persistence`. Use `DATABASE_RUNTIME_URL` for the API and `DATABASE_MIGRATION_URL` only for migrations; never point the API at the Cloud SQL admin connection.

## Layout

Each feature owns its router, routes, and services:

```text
src/
  app.ts                 active API version and version router
  integrations/{router.ts,routes/,services/}
  organization/{router.ts,services/}
  workflows/{router.ts,routes/,services/,temporal-client.ts,types.ts}
  webhooks/{router.ts,routes/}
  health/router.ts
  database.ts
  middleware/{aos.ts,error-handler.ts,request-logging.ts}
  auth/identity-platform.ts
  config.ts
  server.ts
```
