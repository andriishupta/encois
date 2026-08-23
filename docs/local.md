# Local application flow

This is the repeatable local path for testing the current Encois application
through Docker Compose. It is separate from Terraform and from the hosted
Google Cloud Identity Platform deployment.

## Start

From the repository root:

```bash
pnpm run dev:local
```

The stack starts:

| Service | URL | Purpose |
| --- | --- | --- |
| Dashboard | http://localhost:5173 | React application served by Vite with HMR |
| API Gateway | http://localhost:8787 | Auth, authorization, waitlist, and workflows |
| Firebase Auth Emulator | http://localhost:9099 | Local Firebase-compatible identity service |
| Emulator UI | http://localhost:4000 | Inspect local Auth users |
| Temporal UI | http://localhost:8233 | Inspect local workflow executions |
| Agent Gateway | http://localhost:8080 | Private policy/tool broker in mock data mode |
| Agent Runtime | http://localhost:8090 | Go Temporal Worker with Mock AI and local data adapters |
| PostgreSQL | localhost:5432 | Encois control-plane database |

`local-auth-seed` runs after migrations. It creates one deterministic local
dataset for `Organization Sun`. It includes hierarchical units, users with
different roles and scopes, integrations, Knowledge Sources with revisions and
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

## Development watch mode

This local mock mode uses development containers with live reload:

- Dashboard runs Vite with HMR on `http://localhost:5173`.
- API Gateway runs `tsx watch` and restarts on TypeScript changes.
- Agent Gateway and Agent Runtime run Go `air` watchers and rebuild only their
  local binaries on Go changes.
- Postgres, Temporal, Firebase Auth Emulator, migrations, and the local auth
  seed are not rebuilt on application source changes.

Stop it with:

```bash
pnpm run dev:local:down
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
docker compose -f compose.local.yaml exec postgres \
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
docker compose -f compose.local.yaml run --rm local-auth-seed \
  node dist/scripts/verify-local.js

docker compose -f compose.local.yaml run --rm \
  -e LOCAL_API_URL=http://api-gateway:8787/api/v1 \
  local-auth-seed node dist/scripts/verify-local-api.js
```

The same checks are available from the repository root:

```bash
pnpm run verify:local
pnpm run verify:local:api
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
docker compose -f compose.local.yaml ps
curl http://localhost:8787/health/live
curl http://localhost:8787/health/ready
docker compose -f compose.local.yaml logs -f api-gateway local-auth-seed
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

## Production-like local mode

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
pnpm run dev:local:down
```

To reset only the known local fixture organizations and accounts (without
touching unrelated database data):

```bash
docker compose -f compose.local.yaml run --rm local-auth-seed \
  node dist/scripts/reset-local.js
docker compose -f compose.local.yaml run --rm local-auth-seed
```

The reset is deliberately scoped to the fixture slugs/emails. It does not
delete Docker volumes. The Agent Runtime memory mock and Agent Gateway graph /
artifact mocks are process-scoped, so restart those two services after a
manual reset to clear their in-memory state as well. The same operation is
available as:

```bash
pnpm run local:reset
```

The seed is safe to run repeatedly and will not create duplicate memberships,
integrations, revisions, or onboarding rows.
To run only the idempotent seed without resetting fixtures, use
`pnpm run local:seed`.

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
