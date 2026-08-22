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

`local-auth-seed` runs after migrations. It creates a deterministic local
dataset for two isolated organizations: `Organization Test` and `Organization
Avengers`. Each organization gets its own units, users, integrations,
Knowledge Sources with revisions and ingestion runs, webhook deliveries, six
workflow projections, and workflow event timelines. It is idempotent and only
creates or updates these local fixture records.
Each workflow timeline includes activity start/completion or failure events,
retry attempts, shard labels, evidence references, and issue metadata. These
are control-plane projections for the local mock; they do not create Temporal
executions.

Local credentials:

```text
email:    owner@local.test
password: local-password-1234
```

Existing-workspace users:

| Email | Password | Organization | Role | Scope |
| --- | --- | --- | --- | --- |
| `owner@local.test` | `local-password-1234` | Organization Test | organization admin | All units |
| `dev@local.test` | `local-dev-1234` | Organization Test | organization admin | All units; full product pages |
| `manager@local.test` | `local-manager-1234` | Organization Test | organization admin | All units; full product pages |
| `test@local.test` | `local-test-1234` | Organization Test | viewer | Checkout only; read-only |
| `avengers-owner@local.test` | `local-avengers-1234` | Organization Avengers | organization admin | All units |
| `avengers-manager@local.test` | `local-avengers-manager-1234` | Organization Avengers | manager | Product and descendants |

The five `onboarding1..5@local.test` users are verified Firebase Emulator
accounts with organization invites. On first sign-in the invite is accepted
and the fixture receives `onboarding:manage`, so the local onboarding screens
open instead of the waitlist. They are intentionally separate from the main
active users so onboarding can be tested repeatedly without changing the
full-access fixture. Their passwords are `local-onboarding-1` through
`local-onboarding-5`.
The dashboard stores mock onboarding state by organization and Firebase user,
so switching between these accounts in one browser does not reuse another
account's progress.

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

## Onboarding test

1. Start Compose and wait until `local-auth-seed` exits with code `0`.
2. Open http://localhost:5173/login.
3. Use any active or onboarding credentials above.
4. The Dashboard calls `GET /api/v1/auth/me` with the emulator ID token.
5. The API finds the pending invite and transactionally creates:
   - `users`;
   - `organization_memberships`;
   - `membership_scopes`;
   - the accepted invite record.
6. Continue through the existing onboarding screens.

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

After the seed completes, verify the expected tenant fixtures and workflow
states with:

```bash
docker compose -f compose.local.yaml run --rm local-auth-seed \
  node dist/verify-local.js

docker compose -f compose.local.yaml run --rm \
  -e LOCAL_API_URL=http://api-gateway:8787/api/v1 \
  local-auth-seed node dist/verify-local-api.js
```

The same checks are available from the repository root:

```bash
pnpm run verify:local
pnpm run verify:local:api
```

The second command signs in through the Firebase Auth Emulator and verifies
owner and Avengers-owner visibility, restricted `test@local.test` hierarchy
scope, rejection of unauthorized workflow changes and out-of-scope events,
onboarding invite acceptance and `onboarding:manage`, workflow events, and
rejection of cross-organization headers.

## Useful checks

```bash
docker compose -f compose.local.yaml ps
curl http://localhost:8787/health/live
curl http://localhost:8787/health/ready
docker compose -f compose.local.yaml logs -f api-gateway local-auth-seed
```

The local Agent Runtime uses `AGENT_AI_MODE=mock` and the local data plane uses
`AGENT_GATEWAY_DATA_MODE=mock` plus `AGENT_MEMORY_MODE=mock` and
`AGENT_MEMORY_FIXTURE=local`, while the
dashboard explicitly uses `VITE_ENCOIS_UI_MODE=mock`. No Gemini key or GCP
credentials are required. Temporal, source ingestion, Graph, Memory Bank,
Cloud Storage, and the synthetic Agent Gateway tools all have local
implementations. The mock Graph and Memory adapters create deterministic
organization-scoped fixtures on first access; source ingestion can later add
realistic projections to the same tenant-scoped stores. External Jira/GitHub
calls remain deterministic fixtures; live provider credentials and adapters
are hosted follow-up work.

In this explicit dashboard mock mode, onboarding also exposes a `Use local
fixture` action so the complete first-run flow can be reviewed without a PDF
file or a running API. It is available only in mock mode and is not rendered
in hosted builds.

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
  node dist/reset-local.js
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
integrations, revisions, or workflow projections.
To run only the idempotent seed without resetting fixtures, use
`pnpm run local:seed`.

## Verification scope

The local auth path is covered by configuration/type/build checks and the
existing API auth/invite tests. Compose uses the Postgres-backed `database`
workflow mock for seeded UI projections; Temporal remains available for the Go
runtime and real workflow smoke tests. The full browser onboarding and
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
