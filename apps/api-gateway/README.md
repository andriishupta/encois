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
- `GET /health/ready` — readiness check; in production it verifies the runtime database, Identity Platform, Temporal, execution capability, OAuth, artifact storage, private services, and HTTPS CORS configuration before returning `200`.
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
`password` provider, and uses `scripts/seed-local.ts` to create two isolated fixture
organizations (`Organization Test` and `Organization Avengers`), active users,
five onboarding invite users, scoped organization units, integrations,
Sources/revisions, ingestion runs, and webhooks. It does not create
workflow executions or fake workflow timelines; those come from the local
Temporal server. The seed is idempotent and local-only.

The production API image uses the `production` Docker target and contains only
the Gateway server. Local Compose selects the separate `local-seed` target so
seed and verification scripts are not shipped in production.

### Organization onboarding readiness

Organization onboarding is a server-enforced tenant lifecycle. The persisted
status is `pending`, `initializing`, `ready`, or `failed`; a missing
`organization_onboarding` row is a data/migration error, not `pending`.

- Missing row: ordinary tenant routes are blocked with
  `ORGANIZATION_ONBOARDING_NOT_FOUND` (`503`). Reads do not create a fallback
  row.
- `pending`, `initializing`, or `failed`: ordinary dashboard, membership,
  integration, Workflow, Run, and review routes are blocked with
  `ORGANIZATION_ONBOARDING_REQUIRED` (`409`). Only the onboarding settings and
  Source upload/ingestion paths, active Template/current approved Blueprint
  catalogs, and authorized start/retry operations remain available.
- `ready`: the normal dashboard opens and the existing authentication,
  organization scope, and permission rules apply.

`POST /api/v1/organization/onboarding/start` moves an eligible organization to
`initializing` only after Temporal accepts the idempotent Coordinator start.
The Coordinator's versioned `coordinator.v1` callback persists `ready` or
`failed` after initial reconciliation. The browser never supplies Coordinator,
Blueprint revision, Workflow, Run, or Temporal IDs. Service readiness at
`GET /health/ready` is independent from this tenant-level onboarding gate.

See the full [onboarding flow and state matrix](../../docs/flows.md#onboarding-readiness-states),
[contract rules](../../docs/contracts.md#organization-onboarding-and-readiness),
and [local lifecycle test](../../docs/local.md#authentication-and-onboarding-test).

Current blueprint routes:

- `GET /api/v1/integrations` — list integrations visible to the authenticated user's organization scope.
- `POST /api/v1/integrations/:integrationId` — update an integration after object-level authorization.
- `GET /api/v1/integrations/:integrationId/webhook` — read the scoped webhook endpoint projection without returning a secret.
- `POST /api/v1/integrations/:integrationId/webhook` — provision or repair a signed endpoint; the generated secret is returned once and stored in Secret Manager (or the local fixture adapter).
- `POST /api/v1/integrations/:integrationId/webhook/rotate`, `/enable`, and `/disable` — rotate the signing secret or control delivery state with Integration manage permission and audit events.
- `GET /api/v1/sources` — list Sources visible in the caller's scope.
- `POST /api/v1/sources` — register an integration, uploaded-document, manual, or media Source.
- `POST /api/v1/sources/uploads` — upload a validated PDF (up to 10 MiB) as a new source and immutable revision; production requires `SOURCE_ARTIFACT_BUCKET`.
- `GET /api/v1/sources/:sourceId` — read a Source and its immutable revisions.
- `GET /api/v1/sources/:sourceId/revisions/:revisionId/raw` — download an uploaded raw file after the same authenticated Source-scope checks; the API, not the browser, reads Cloud Storage.
- `POST /api/v1/sources/:sourceId/revisions` — register a revision by artifact/provider reference; raw bytes are not stored in Postgres or Temporal.
- `POST /api/v1/sources/:sourceId/revisions/:revisionId/ingest` — start the platform-owned `encois.source-ingestion.v1` Workflow.
- `POST /api/v1/webhooks/:organizationId/:endpointKey` — public signed provider ingress (`X-Encois-Event-Id` and `X-Encois-Signature`), retained outside Postgres, idempotently mapped to integration Sources, and handed to the existing ingestion workflow. Payloads are limited to 1 MiB; production requires `SOURCE_ARTIFACT_BUCKET` and Secret Manager-backed endpoint secrets.
- `GET /api/v1/organization` — return the caller-visible organization, units, members, and direct membership permissions.
- `GET /api/v1/organization/units` — list organization units visible to the caller.
- `POST /api/v1/organization/units` — create a child unit inside an administrator or manager scope.
- `GET /api/v1/organization/members` — list members visible to the caller's management scope.
- `GET /api/v1/organization/permissions` — list direct membership scopes the caller can administer.
- `POST /api/v1/organization/permissions` — create or update a direct membership scope.
- `PATCH /api/v1/organization/permissions/:permissionId` — change a direct scope's access level.
- `DELETE /api/v1/organization/permissions/:permissionId` — remove a direct scope; the Gateway writes an audit event.
- `POST /api/v1/workflows` — start a workflow through the configured Temporal namespace.
- `GET /api/v1/workflows` — list tenant-visible workflow projections.
- `GET /api/v1/workflows/activity` — list recent tenant-visible workflow events for the dashboard feed.
- `POST /api/v1/workflows` — generic Blueprint start/reuse endpoint.
- `GET /api/v1/workflows/templates` — return up to 10 published, tenant-visible provider-neutral workflow templates; supports `q`, `category`, and `limit`.
- `POST /api/v1/workflows/plans/validate` — validate a typed `workflow-change-plan.v1` lifecycle proposal without applying it.
- `POST /api/v1/workflows/plans` — persist an idempotent v1 proposal as `proposed` when Postgres is configured.
- `GET /api/v1/workflows/plans` — list persisted proposals visible to the caller's organization and execution scope.
- `POST /api/v1/workflows/plans/:planId/approve` — approve a persisted proposal; application is still a separate step.
- `POST /api/v1/workflows/plans/:planId/apply` — apply an approved v1 `create`, Blueprint `update`/`deprecate`/`restore`/`set_current`, or cancel-only proposal and enqueue its Coordinator event; only an explicit `start` intent launches the approved Blueprint snapshot.
- `POST /api/v1/workflows/:workflowId/cancel` — request cancellation for an active, tenant-visible Run when the caller has `workflows:run`; the Gateway records an audit event and delegates cancellation to the configured workflow client.
- `POST /api/v1/workflows/:workflowId/rerun` — create a new server-keyed Run from the persisted Blueprint revision, business input, and scope of a terminal parent Run; the parent relationship is retained for history and audit.
- `POST /api/v1/internal/coordinator/plans/validate` — private Runtime/Coordinator plan preview; requires `X-Encois-Service-Token` and `X-Organization-ID`.
- `POST /api/v1/internal/coordinator/plans` — private Runtime/Coordinator plan submission; the human approval boundary remains in the Gateway.
- `POST /api/v1/internal/coordinator/workflows` — private start path for an approved tenant Blueprint reference; it reuses the generic workflow service and does not expose the database.
- `GET /api/v1/workflows/:workflowId` — read a tenant-authorized workflow projection.
- `GET /api/v1/workflows/:workflowId/events` — read tenant- and hierarchy-authorized activity, evidence, and lifecycle events.
- `POST /api/v1/workflows/:workflowId/signals` — send an authorized approval Signal.
- `POST /api/v1/workflows/:workflowId/updates` — apply an authorized context Update to an active workflow.
- `POST /api/v1/context/graph/query` — super-admin-only, allowlisted, read-only Spanner Graph inspection through the private Agent Gateway.
- `POST /api/v1/context/memory/query` — super-admin-only, scoped, read-only Agent Memory inspection through the private Agent Runtime.

Workflow Templates are stored in the Gateway control plane as searchable
metadata plus immutable JSONB versions. They use logical capabilities and
provider slots, so a template can resolve to GitHub or GitLab, Jira or Linear,
and Slack or Teams. Workflow Creator later maps a selected template to a
validated tenant Blueprint; the Go Runtime does not read this catalog.
Sources are a separate control-plane model. Templates do not create
Sources, revisions, or ingestion runs.

During preview, the Gateway resolves each Template provider slot against an
active organization Integration, a matching unit-scoped Source, and the
caller's organization scope. The preview returns resolved and missing slots so
the UI can explain the gap; required gaps block plan submission and
application, while optional gaps are returned as warnings.
Integration IDs remain server-side and are not accepted from the browser as
workflow-creation input.

The API always requires `ENCOIS_WORKFLOW_MODE=temporal`,
`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_TASK_QUEUE`, with
either `TEMPORAL_API_KEY` or mTLS settings for hosted Temporal. It fails closed
instead of selecting a product fixture backend. Local fixture data is created
by `scripts/seed-local.ts`; it is not a workflow execution adapter. The API
starts executions and the Go runtime owns the workers that poll the task queue.

`AGENT_GATEWAY_POLICY_VERSION` must match the policy version configured in the
private Agent Gateway; it is propagated through the generic workflow input and
checked again for every tool invocation.

`AGENT_GATEWAY_URL` and `AGENT_GATEWAY_SERVICE_TOKEN` configure the private
data-plane proxy used by `POST /api/v1/context/graph/query`. The route is
restricted to `organization:manage`, accepts only allowlisted logical queries,
and mints the scoped execution capability server-side. It returns `503` when
the graph data plane is intentionally unavailable; it never falls back to
browser-side mock graph data.

`AGENT_RUNTIME_URL` and `AGENT_RUNTIME_SERVICE_TOKEN` configure the private
read-only proxy used by `POST /api/v1/context/memory/query`. It uses the same
tenant scope and admin permission boundary as graph inspection; Agent Platform
Memory Bank remains owned by the Go Agent Runtime and is never called from the
browser.

The private Coordinator routes use `CONTROL_PLANE_SERVICE_TOKEN` for the local
service boundary. In a database-backed deployment they also require
`CONTROL_PLANE_SERVICE_USER_ID` to resolve an active tenant membership and its
scopes. Cloud Run platform identity can be added alongside this application
token at the deployment boundary.

The API server starts an always-on Coordinator outbox dispatcher alongside the
HTTP listener. It polls every second, discovers organizations with pending
events, and delivers them to Temporal with bounded lease/retry behavior. A
database or Temporal outage is logged and retried without stopping the API.
`pnpm dispatch:coordinator` remains available as a one-shot operator command
that drains one bounded batch across all organizations.

Identity Platform verification is available through `src/auth/identity-platform.ts`. It uses Firebase Admin SDK + Application Default Credentials, so Cloud Run can use its service identity without a checked-in key. The resolver that maps an external subject to an organization membership is intentionally injected and must use the database package.

Operator lifecycle scripts use `DATABASE_MIGRATION_URL`:

```bash
pnpm --filter @encois/api-gateway auth:bootstrap-organization -- --organization "Example Company" --email owner@example.com
pnpm --filter @encois/api-gateway auth:invite-user -- --organization-id <organization-id> --email member@example.com
pnpm --filter @encois/api-gateway auth:list-waitlist
pnpm --filter @encois/api-gateway auth:revoke-invite -- --invite-id <invite-id>
```

They are private operator tooling and intentionally do not create provider
accounts. The first invited user accepts access by completing Google login.

Cloud SQL access is owned by `@encois/database`. Use `DATABASE_RUNTIME_URL` for the API and `DATABASE_MIGRATION_URL` only for migrations; never point the API at the Cloud SQL admin connection.

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
