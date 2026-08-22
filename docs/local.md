# Local application flow

This is the repeatable local path for testing the current Encois application
through Docker Compose. It is separate from Terraform and from the hosted
Google Cloud Identity Platform deployment.

## Start

From the repository root:

```bash
pnpm dev:local
```

The stack starts:

| Service | URL | Purpose |
| --- | --- | --- |
| Dashboard | http://localhost:5173 | React application served by Nginx |
| API Gateway | http://localhost:8787 | Auth, authorization, waitlist, and workflows |
| Firebase Auth Emulator | http://localhost:9099 | Local Firebase-compatible identity service |
| Emulator UI | http://localhost:4000 | Inspect local Auth users |
| Temporal UI | http://localhost:8233 | Inspect local workflow executions |
| Agent Gateway | http://localhost:8080 | Private policy/tool broker in mock data mode |
| Agent Runtime | http://localhost:8090 | Go Temporal Worker with Mock AI and local data adapters |
| PostgreSQL | localhost:5432 | Encois control-plane database |

`local-auth-seed` runs after migrations. It creates a complete deterministic
fixture company: one owner waiting for first-login onboarding, three active
users with different roles/scopes, organization units, two integrations, and
three Knowledge Sources. It is idempotent and only creates or updates these
local fixture records.

Local credentials:

```text
email:    dev@local.test
password: local-password-1234
```

Existing-workspace users:

| Email | Password | Role | Scope | Expected access |
| --- | --- | --- | --- | --- |
| `manager@local.test` | `local-manager-1234` | manager | Engineering | Can manage Knowledge Sources in assigned scope |
| `member@local.test` | `local-member-1234` | member | Checkout | Can manage Knowledge Sources in assigned scope |
| `dev@localtest` | `local-viewer-1234` | viewer | Customer Success | Read-only; cannot manage Knowledge Sources |

`dev@local.test` is the organization owner. On a clean local database, this
user accepts the pending invite through `/api/v1/auth/me` and can complete
onboarding. The other three users already have active memberships and should
go directly to the existing workspace. If a non-owner opens an onboarding URL
directly, the dashboard shows an access message and does not render the setup
form. The API remains the final authorization boundary.

Open the Dashboard and use **Sign in locally**. The local login uses Firebase
Auth Emulator only. Production remains invite-only Google sign-in.

## Development watch mode

For active development with live reload, use:

```bash
pnpm dev:local:watch
```

This uses the same local infrastructure but separate development containers:

- Dashboard runs Vite with HMR on `http://localhost:5173`.
- API Gateway runs `tsx watch` and restarts on TypeScript changes.
- Agent Gateway and Agent Runtime run Go `air` watchers and rebuild only their
  local binaries on Go changes.
- Postgres, Temporal, Firebase Auth Emulator, migrations, and the local auth
  seed are not rebuilt on application source changes.

Stop it with:

```bash
pnpm dev:local:watch:down
```

The existing `pnpm dev:local` remains the packaged local mode: it builds the
production-style application images and serves the Dashboard through Nginx.

## Onboarding test

1. Start Compose and wait until `local-auth-seed` exits with code `0`.
2. Open http://localhost:5173/login.
3. Use the local credentials above.
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

## Useful checks

```bash
docker compose -f compose.local.yaml ps
curl http://localhost:8787/health/live
curl http://localhost:8787/health/ready
docker compose -f compose.local.yaml logs -f api-gateway local-auth-seed
```

The local Agent Runtime uses `AGENT_AI_MODE=mock` and the local data plane uses
`AGENT_GATEWAY_DATA_MODE=mock` plus `AGENT_MEMORY_MODE=mock`, while the
dashboard explicitly uses `VITE_ENCOIS_UI_MODE=mock`. No Gemini key or GCP
credentials are required. Temporal, source ingestion, Graph, Memory Bank,
Cloud Storage, and the synthetic Agent Gateway tools all have local
implementations. External Jira/GitHub calls remain deterministic fixtures;
live provider credentials and adapters are hosted follow-up work.

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
pnpm dev:local:down
```

To repeat onboarding from a clean database and Auth Emulator:

```bash
docker compose -f compose.local.yaml down -v
pnpm dev:local
```

The `-v` option removes only the Compose-local Postgres and Temporal volumes.
If this workspace was started before the deterministic fixture seed was added,
run this reset once: older Firebase Emulator UIDs could leave duplicate local
membership rows. The current seed is safe to run repeatedly and will not create
new duplicates.

## Verification scope

The local auth path is covered by configuration/type/build checks and the
existing API auth/invite tests. The full browser onboarding and Temporal
workflow demonstration should be run manually after the stack starts; it is
not hidden inside the Compose startup command.

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
