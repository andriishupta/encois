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

`local-auth-seed` runs after migrations. It creates a verified Firebase
emulator account and a pending Encois organization invite. It deliberately does
not create the Encois `users` row; the normal `/api/v1/auth/me` onboarding path
creates that row and the active membership after the first successful login.

Local credentials:

```text
email:    dev@local.test
password: local-password-1234
```

Open the Dashboard and use **Sign in locally**. The local login uses Firebase
Auth Emulator only. Production remains invite-only Google sign-in.

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
