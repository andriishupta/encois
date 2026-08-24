# Local application flow

This is the repeatable local path for testing the current Encois application
through Docker Compose. It is separate from Terraform and from the hosted
Google Cloud Identity Platform deployment.

## Compose modes

The repository has three intentionally different Compose modes:

| Mode | Command | Dependencies | Application containers |
| --- | --- | --- | --- |
| Watch mock | `pnpm run dev:watch:mock` | Local Postgres, Temporal dev server, Firebase Auth and Storage Emulators, mock data adapters | Development images with live reload |
| Watch prod | `pnpm run dev:watch:prod` | Managed services from `.env.local.prod` | Development images with live reload |
| Local prod | `pnpm run dev:local:prod` | Managed services from `.env.local.prod` | Production Docker images, no watch mode |

Use Watch mock first for deterministic local workflows. Use Watch prod when
you need to exercise real Temporal Cloud, Spanner, Memory Bank, Cloud Storage,
Gemini, Identity Platform, and managed Postgres credentials while keeping
source changes live. Use Local prod to validate the built production images.

## Start

From the repository root:

```bash
pnpm run dev:watch:mock
```

The stack starts:

| Service | URL | Purpose |
| --- | --- | --- |
| Dashboard | http://localhost:5173 | React application served by Vite with HMR |
| API Gateway | http://localhost:8787 | Auth, authorization, waitlist, and workflows |
| Firebase Auth Emulator | http://localhost:9099 | Local Firebase-compatible identity service |
| Firebase Storage Emulator | http://localhost:9199 | Durable local raw Source files for the watch-mock volume |
| Emulator UI | http://localhost:4000 | Inspect local Auth users |
| Temporal UI | http://localhost:8233 | Inspect local workflow executions |
| Agent Gateway | http://localhost:8080 | Private policy/tool broker in mock data mode |
| Agent Runtime | http://localhost:8090 | Go Temporal Worker with Mock AI and local data adapters |
| PostgreSQL | localhost:5432 | Encois control-plane database |

To apply new local database migrations without rebuilding the rest of the
stack, run:

```bash
pnpm run migration:watch:mock
```

This rebuilds only the `migrations` image, runs the one-shot migration job,
and removes its disposable container. A plain `docker compose run migrations`
does not necessarily rebuild the image, so it can run an older migration
bundle.

`local-auth-seed` runs after migrations. It creates one deterministic local
dataset for `Organization Sun`. It includes hierarchical units, users with
different roles and scopes, organization Integrations, unit-scoped Sources with revisions and
ingestion runs, webhook deliveries, and persisted workflow runs/events.
It also ensures the Organization Sun onboarding row is explicitly `ready` for
the pre-bootstrapped demo organization. That fixture is intentionally ready so
the standard local dashboard can be used immediately; it is not a substitute
for testing the incomplete onboarding lifecycle. It is idempotent and only
creates or updates these local fixture records. The seeded workflow rows
deliberately have no Temporal execution, so opening one can exercise the
unavailable-runtime error path. The API-backed lifecycle and route gate are
defined in [`flows.md`](flows.md#onboarding-readiness-states) and
[`contracts.md`](contracts.md#organization-onboarding-and-readiness).

Local credentials:

```text
email:    owner@local.test
password: local-password-1234
```

Existing-workspace users:

| Email | Password | Organization | Role | Scope |
| --- | --- | --- | --- | --- |
| `owner@local.test` | `local-password-1234` | Organization Sun | organization admin | All units |
| `manager@local.test` | `local-manager-1234` | Organization Sun | manager | Engineering and descendants |
| `dev@local.test` | `local-dev-1234` | Organization Sun | manager | Development and descendants |
| `viewer@local.test` | `local-viewer-1234` | Organization Sun | viewer | Checkout only; read-only |

The three `onboarding1..3@local.test` users are verified Firebase Emulator
accounts with organization invites. On first sign-in the invite is accepted
and the fixture receives `onboarding:manage`, so organization initialization
settings can be reviewed through the API-backed workspace settings surface.
They are invite-acceptance fixtures in an already-ready demo organization;
they do not put that organization back into `pending`. Their passwords are
`local-onboarding-1` through `local-onboarding-3`.

Open the Dashboard and use **Sign in locally**. The local login uses Firebase
Auth Emulator only. Production remains invite-only Google sign-in.

## What the local stack actually tests

The local stack is a real vertical execution path with explicit infrastructure
and provider adapters at the edges:

| Boundary | Local behavior | What it proves |
| --- | --- | --- |
| Dashboard, API Gateway, Postgres | Real processes and persisted control-plane data | Auth, organization scope, permissions, source/workflow/run projections |
| Temporal | Real local Temporal Server in Namespace `default` | Workflow start, Activities, retries, Signals, and worker execution |
| Agent Runtime | Real Go worker with `AGENT_AI_MODE=mock` | Blueprint interpretation and runtime state transitions without model credentials |
| Agent Gateway | Real private policy/tool broker; artifact access uses the Firebase Storage Emulator while Graph/provider adapters remain mocked | Service authentication, capability/policy checks, and local Source ingestion |
| Jira/GitHub and other providers | Deterministic adapter fixtures | Stable tool schemas and success/failure handling, not live provider behavior |
| Graph and Memory | Process-local mock stores | Contract and UI behavior for deterministic local data; state is lost on process restart |
| Cloud Storage | Firebase Storage Emulator in Watch mock; managed Cloud Storage in Watch prod/Local prod | Raw Source files are stored outside Postgres under an organization/unit-scoped object key |

Mocks are limited to infrastructure or third-party adapter boundaries. They do
not create fake users, organizations, permissions, workflows, runs, or other
control-plane state. A successful local run therefore means that the Encois
flow works with the configured adapter fixtures; it does not prove that a live
GitHub/Jira/Memory Bank/Spanner/Cloud Storage deployment is configured.

## Full manual vertical slice

Use this sequence when testing how the product components are connected:

1. Start the stack and wait until `local-auth-seed` completes successfully.
   Check `docker compose -f compose.watch.mock.yaml ps`, then open the Dashboard,
   Temporal UI, and Emulator UI.
2. Sign in as `owner@local.test`. Confirm that the organization, units,
   integrations, Sources, workflows, graph, and memory pages load.
   Run `pnpm run verify:watch:mock:api` if the auth, invite, or scope boundary is
   the subject of the check.
3. Repeat the same navigation as `manager@local.test`, `dev@local.test`, and
   `viewer@local.test`. The visible hierarchy may include context needed to
   explain the organization, but reads and mutations must remain within the
   user's effective unit scope. Viewer actions must be rejected by the API,
   not only hidden in the Dashboard.
4. Open Organization Sources and upload a small PDF. Confirm that the API
   creates the Source, immutable revision, and ingestion-run projection. Start
   ingestion only through the product action and follow its status in the UI.
   In Watch mock, the PDF is written to the Firebase Storage Emulator and the
   revision keeps a scoped object key such as
   `organizations/{organizationId}/units/{unitId}/sources/{sourceId}/...`.
   Open the Source detail and use **Download raw file**; the API repeats the
   Source permission check before reading the object. Agent Gateway reads the
   same object during Source ingestion, so the PDF can reach the local parser.
   The emulator data is persisted in the `encois-firebase-data` Compose volume.
5. Open Workflows and use an approved Blueprint or Template. Before running,
   confirm that its tools exist in the local Agent Gateway fixture catalog.
   The current local catalog includes `jira.project_tasks` and
   `github.project_activity`; arbitrary example names are not automatically
   available. The seed creates organization-level GitHub and Jira
   Integrations, a GitHub Source in Engineering, and a Jira Source in
   Customer Success. Select Engineering to exercise GitHub templates or
   Customer Success to exercise Jira templates, then choose that allowed
   organization scope and start the workflow.
6. Follow the run in the Dashboard, Activity, workflow detail, and Temporal
   UI. The local run should traverse API Gateway -> Temporal -> Go Agent
   Runtime -> Agent Gateway -> deterministic tools -> API projections. The
   seeded persisted workflow rows are deliberately not Temporal executions;
   use a newly started run to test the successful execution path.
7. Inspect the resulting evidence, graph projection, and memory projection.
   Remember that local Graph and Memory state is process-local and resets when
   the corresponding Go service restarts. The local Memory adapter is useful
   for contract and permission checks, not for validating Vertex AI Memory Bank
   scope semantics.
8. Repeat the run with a missing or unsupported tool, an unavailable provider
   fixture, and a viewer account. Expected outcomes are an explicit failed or
   denied run with a stable error, never a fabricated successful result.

For a smaller backend-only check, use:

```bash
pnpm smoke:release:local
```

It starts an isolated local Temporal server and Go services, runs the release
and approval flows, and cleans up those child processes. It is useful for
verifying the execution boundary without logging into the Dashboard; it does
not replace the full manual source, permission, graph, or memory walkthrough.

## Temporal inspection and failure diagnosis

The containerized stack uses Temporal Namespace `default`, address
`127.0.0.1:7233`, and task queue `encois-agent-runtime`:

```bash
temporal workflow list \
  --address 127.0.0.1:7233 \
  --namespace default
```

Use the Temporal UI at `http://localhost:8233` to open a run and inspect its
Events, Activity attempts, retries, and failure details. Compare that with the
Dashboard run events and service logs:

```bash
docker compose -f compose.watch.mock.yaml logs -f api-gateway
docker compose -f compose.watch.mock.yaml logs -f agent-runtime
docker compose -f compose.watch.mock.yaml logs -f agent-gateway
```

If a run fails with `403`, first compare the Blueprint tool name and declared
scope with the Agent Gateway tool catalog and policy. A previous local failure
was caused by a Blueprint referring to tools that were not in the configured
local allowlist; Temporal and the worker were running correctly. If no
execution exists in Temporal, the item is likely one of the seeded persisted
workflow rows and exercises the unavailable-runtime path instead.

## Watch mock mode

This local mock mode uses development containers with live reload:

- Dashboard runs Vite with HMR on `http://localhost:5173`.
- API Gateway runs `tsx watch` and restarts on TypeScript changes.
- Agent Gateway and Agent Runtime run Go `air` watchers and rebuild only their
  local binaries on Go changes.
- Postgres, Temporal, Firebase Auth Emulator, migrations, and the local auth
  seed are not rebuilt on application source changes.

Stop it with:

```bash
pnpm run dev:watch:mock:down
```

## Authentication and onboarding test

The seeded demo organizations are already `ready`, so signing in with the
active users above tests authentication, invite acceptance, permissions, and
the normal dashboard. It does not test a blocked organization. The
`onboarding1..5` users test the same invite acceptance path and may review
onboarding settings after joining a ready organization.

To test the strict organization lifecycle, use a newly bootstrapped local
organization rather than changing the seeded fixture:

1. Start Compose and wait until `local-auth-seed` exits with code `0`.
2. Run the operator `auth:bootstrap-organization` flow to create a new
   organization, root unit, admin invite, and `organization_onboarding` row in
   `pending`.
3. Sign in with the invited Firebase Emulator account. `GET /api/v1/auth/me`
   accepts the invite and creates the local user, membership, and scope, but
   the dashboard keeps the user in onboarding.
4. Verify that ordinary dashboard, member/unit, integration, Workflow, Run,
   review, and other product routes are rejected with
   `ORGANIZATION_ONBOARDING_REQUIRED` (`409`). Onboarding settings, Source
   upload/ingestion, and Template/Blueprint catalog reads remain available
   according to permission.
5. Complete the required onboarding upload and catalog selection. The final
   action calls `POST /api/v1/organization/onboarding/start`; the state must
   become `initializing`, never optimistic `ready`.
6. Observe the local Temporal Coordinator. Its first reconciliation reports
   `ready` only after required context validation, or `failed` when bootstrap
   errors or is deferred. An administrator can explicitly retry a failed
   onboarding; a non-admin receives the administrator handoff.

An onboarding row must never be created by a dashboard fallback or a normal
`GET /api/v1/organization` read. To diagnose a missing row, inspect the
control-plane migration/backfill and repair the data through the operator
flow. `ORGANIZATION_ONBOARDING_NOT_FOUND` is a `503` data/readiness error, not
the `pending` user experience.

To inspect the resulting database rows:

```bash
docker compose -f compose.watch.mock.yaml exec postgres \
  psql -U postgres -d encois -c \
  'select email, identity_subject from users;'
```

The same flow is intentionally invite-based. A Firebase user without a
matching pending invite must remain `pending` and can only use the waitlist;
the waitlist never creates an Encois membership.

The existing organization permissions screen is available at
`/organization/permissions`. Operator invite scripts support adding a single
user (`auth:invite-user`) or revoking an invite. A bulk invite editor is not
part of this local MVP fixture and remains a separate product-surface task.

After the seed completes, verify the expected tenant, onboarding, source, and
integration fixtures with:

```bash
docker compose -f compose.watch.mock.yaml run --rm local-auth-seed \
  node dist/scripts/verify-local.js

docker compose -f compose.watch.mock.yaml run --rm \
  -e LOCAL_API_URL=http://api-gateway:8787/api/v1 \
  local-auth-seed node dist/scripts/verify-local-api.js
```

The same checks are available from the repository root:

```bash
pnpm run verify:watch:mock
pnpm run verify:watch:mock:api
pnpm run verify:production-auth
```

`verify:production-auth` checks the source and Docker target boundaries without
building or starting services. After production artifacts already exist, add
`-- --artifacts` to scan the generated files as well.

The repository runners remove only disposable migration containers left in a
`Created` or failed state before starting a seed or verification command. This
keeps an interrupted Compose bootstrap from blocking the next local check;
Postgres volumes and application containers are not removed.

The second command signs in through the Firebase Auth Emulator and verifies
owner and Viewer access, Engineering/Development hierarchy scopes, onboarding
invite acceptance and `onboarding:manage`, Temporal workflow list access, and
the seeded persisted workflow boundary. The persisted fixture runs are not
created in Temporal; their detail page should therefore expose the runtime
availability error instead of pretending that an execution exists.

## Useful checks

```bash
docker compose -f compose.watch.mock.yaml ps
curl http://localhost:8787/health/live
curl http://localhost:8787/health/ready
docker compose -f compose.watch.mock.yaml logs -f api-gateway local-auth-seed
```

The local Agent Runtime uses `AGENT_AI_MODE=mock` and the local data plane uses
`AGENT_GATEWAY_DATA_MODE=mock` plus `AGENT_MEMORY_MODE=mock` and
`AGENT_MEMORY_FIXTURE=local`. No Gemini key or GCP credentials are required.
The dashboard uses the API Gateway and the local Temporal server for workflow
execution, while
Graph, Memory Bank, Cloud Storage, and provider calls use explicit data-plane
adapters. The mock Graph and Memory adapters create deterministic
organization-scoped fixtures on first access; source ingestion can later add
realistic projections to the same tenant-scoped stores. External Jira/GitHub
calls remain deterministic fixtures; live provider credentials and adapters
are hosted follow-up work.

## Watch prod mode

Use this mode to run the application containers with live reload while
connecting to the managed services configured in `.env.local.prod`:

```bash
pnpm dev:watch:prod
```

It uses `compose.watch.prod.yaml`, enables Gemini, Vertex Memory Bank, Temporal
Cloud, Identity Platform, Cloud SQL/Postgres, Cloud Storage, and Spanner, and
does not start local emulators or mock data-plane services. Stop it with:

```bash
pnpm dev:watch:prod:down
```

## Local prod build mode

Use this mode to run the Dashboard, API Gateway, Agent Runtime, and Agent
Gateway locally while connecting to the managed services used by the hosted
deployment:

```bash
cp .env.local.prod.example .env.local.prod
# fill in the real project, endpoints, ADC path, and non-committed secrets
pnpm dev:local:prod
```

It uses `compose.local.prod.yaml` with `AGENT_AI_MODE=gemini`, Vertex/Memory
Bank, Temporal Cloud, Identity Platform, Cloud SQL/Postgres, Cloud Storage,
and Spanner. It has no local Postgres, Temporal server, Firebase emulator, or
mock data-plane fallback. Set `LOCAL_UID` and `LOCAL_GID` to the values from
`id -u` and `id -g`; the GCP containers then run as that numeric user and can
read a normal host ADC file without running as root. `GOOGLE_APPLICATION_CREDENTIALS`
must point to an ADC JSON file; `gcloud auth application-default
login` is suitable for local testing. The Dashboard's `VITE_FIREBASE_*`
values are public browser configuration, while service tokens and ADC files
must never be committed.

This runs the service images locally; it does not deploy Cloud Run. Existing
Identity Platform membership/invite data and reachable managed endpoints are
required for a useful end-to-end test. Stop it with:

```bash
pnpm dev:local:prod:down
```

## Reset

To stop the stack:

```bash
pnpm run dev:watch:mock:down
```

To reset only the known local fixture organizations and accounts (without
touching unrelated database data):

```bash
docker compose -f compose.watch.mock.yaml run --rm local-auth-seed \
  node dist/scripts/reset-local.js
docker compose -f compose.watch.mock.yaml run --rm local-auth-seed
```

The reset is deliberately scoped to the fixture slugs/emails. It does not
delete Docker volumes. The Agent Runtime memory mock and Agent Gateway graph /
artifact mocks are process-scoped, so restart those two services after a
manual reset to clear their in-memory state as well. The same operation is
available as:

```bash
pnpm run watch:mock:reset
```

The seed is safe to run repeatedly and will not create duplicate memberships,
integrations, revisions, or onboarding rows.
To run only the idempotent seed without resetting fixtures, use
`pnpm run watch:mock:seed`.

## Verification scope

The local auth path is covered by configuration/type/build checks and the
existing API auth/invite tests. Compose seeds data through an explicit script,
while Temporal remains the only workflow execution backend. The workspace initialization and
workflow demonstration should be run manually after the stack starts.

## What this does not emulate

- Google OAuth popup behavior is not required for the local test; the local
  email/password form talks to Firebase Auth Emulator.
- Firebase emulator identity is not a production credential.
- Terraform is not required for local startup.
- OpenTelemetry export is not required; logs and correlation IDs are available
  through Compose logs. Cloud Trace is configured only for the hosted path.

The remaining test-oriented follow-up is tracked in
[`docs/next-steps.md`](next-steps.md). It covers persistence unit tests,
hosted dependency smoke checks, and pre-production validation without making
those items prerequisites for the local mock path.
