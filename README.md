# Encois

Encois — Enterprise Context Intelligence System — turns fragmented company activity into organizational intelligence.

It connects signals from systems such as GitHub, Jira, Google Workspace, Stripe, and operational monitoring, then uses specialized agents to understand what changed, why it matters, and what deserves attention. The initial product is read-oriented: observe, correlate, explain, and recommend. It does not autonomously run the company.

## How it works

```text
company systems, uploaded documents, manual notes, and MCP/API tools
  -> Knowledge Sources and Integration Packs
  -> unified ingestion and provenance
  -> company-specific Workflow Blueprint
  -> Temporal generic durable execution
  -> Go Agent Runtime with Google ADK
  -> scoped evidence, memory, and Gemini synthesis
  -> Gateway API
  -> React UI and future MCP clients
```

The public Gateway API handles users, organization scope, permissions, registry operations, and workflow control. Temporal manages durable execution, waits, retries, Signals, and recovery. The private Agent Gateway enforces policy before agents access provider APIs or MCP tools. The system is designed for organization and tenant isolation from the beginning.

## Repository layout

The workspace is intentionally small today. As packages are added, use the boundaries described in [`AGENTS.md`](AGENTS.md):

```text
apps/dashboard React SPA
apps/api-gateway Hono API and webhook ingress
apps/agent-runtime Go Temporal workers and Google ADK agents
apps/agent-gateway Private Go policy and tool broker
packages/*     domain, contracts, agents, integrations, database, observability, config
infra/         Google Cloud deployment configuration
docs/          product, architecture, security, and flow documentation
```

Architecture references:

- [`docs/architecture.md`](docs/architecture.md) — product idea, current system, lifecycle, deployment, and future event delivery.
- [`docs/contracts.md`](docs/contracts.md) — OpenAPI, JSON Schema, Blueprint, Temporal, Agent Gateway, and Coordinator boundaries.
- [`docs/operations.md`](docs/operations.md) — local Compose, Temporal inspection, GCP, and CI/CD.
- [`docs/demo.md`](docs/demo.md) — local and hosted demo setup, seed order, AI context population, and user invitation.
- [`docs/security.md`](docs/security.md) — multi-tenant security, trust boundaries, agent policy, secrets, and execution-scoped capabilities.
- [`docs/dictionary.md`](docs/dictionary.md) — canonical architecture and runtime vocabulary.
- [`docs/documentation.md`](docs/documentation.md) — user-facing product guide.
- [`docs/scripts.md`](docs/scripts.md) — supported root commands and script ownership rules.

## Prerequisites

- Node.js 24.19.0 (the project’s pinned LTS runtime) and pnpm 11.
- pnpm 11. The repository declares the expected package-manager family in `package.json`.
- Google Cloud access is only required for the later deployed path; the full local Compose stack uses explicit mock modes for the data plane.

## Install and run

From the repository root:

```bash
pnpm install
```

Start the current dashboard from the repository root:

```bash
pnpm dev
```

The dashboard is available at `http://localhost:5173`. Run the API in a second terminal:

```bash
pnpm --filter @encois/api-gateway dev
```

The API listens on `http://127.0.0.1:8787`. Its local health checks are available at `/health/live` and `/health/ready`. The Go Agent Runtime and Agent Gateway are separate processes and are not part of the default `pnpm dev` command.

Dashboard routes are protected and do not use a sign-up flow. The MVP supports
Google-only Identity Platform sign-in for emails that an operator has invited.
Copy `apps/dashboard/.env.example` to a local env file and provide the Firebase
browser configuration (`VITE_FIREBASE_*`) for real Google sign-in. The API
verifies the ID token and provisions the local `users` row and organization
membership only when a pending invite matches the verified email. Unknown or
pending users are sent to `/waitlist`; they cannot reach tenant routes.

For API-backed local UI work, a development-only bearer session remains
available from the login screen. Never put a hosted or production credential
in a `VITE_*` variable.

The first organization and invited admin are created with the operator script
after migrations have run:

```bash
DATABASE_MIGRATION_URL=... \
pnpm --filter @encois/api-gateway auth:bootstrap-organization -- \
  --organization "Example Company" --email owner@example.com
```

For a local Watch AI/Watch mock onboarding user, create the pending invite and
the matching Firebase Auth Emulator account together:

```bash
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@127.0.0.1:5432/encois \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
pnpm run local:onboarding -- \
  --organization "OB Onboarding Demo" \
  --email "ob+1@local.test" \
  --password "local-onboarding-1"
```

Use `auth:invite-user` for later members and `auth:list-waitlist` to review
unknown visitors. These are private operator scripts, not a public management
UI; the waitlist requires work email, company name, and a company website or
LinkedIn URL, but never grants access.

For the full containerized watch-mock stack, run:

```bash
pnpm run dev:watch:mock
```

This starts Postgres, the Temporal development server, migrations, API Gateway,
Firebase Auth Emulator, local auth seed, Agent Gateway, Agent Runtime, and the
Vite-served dashboard through `compose.watch.mock.yaml`. The local Runtime uses
`AGENT_AI_MODE=mock`; the Agent Gateway and Memory Bank use local adapters, so
no Gemini key or Google Cloud credentials are required. The dashboard uses the
API Gateway and Temporal for workflow execution. Local fixture data is created
by an explicit seed script; it also creates thirty real Temporal-backed demo
executions and fifteen Source fixtures in the demo workspace.
The Temporal UI is available at `http://localhost:8233`; the dashboard is at
`http://localhost:5173`; the Firebase Emulator UI is at
`http://localhost:4000`; and the API health endpoints are at
`http://localhost:8787/health/live` and `/health/ready`. Local login uses
`owner@local.test` / `local-password-1234`. Compose uses the local Temporal
stack for workflow execution; the seed script requires that Temporal server
and fails closed if it is unavailable.
See [`docs/demo.md`](docs/demo.md) for demo accounts, seeding, and the hosted
flow. Follow
service logs with
`docker compose -f compose.watch.mock.yaml logs -f`.

This local service mode includes live reload: the Dashboard uses Vite HMR, the
API restarts on TypeScript changes, and Go watchers rebuild the Agent Gateway
and Agent Runtime. Stop it with `pnpm run dev:watch:mock:down`.

For a local flow that uses the real GCP context and AI services while keeping
the rest local, copy `.env.local.ai.example` to `.env.local.ai`, set the ADC
file path, and run `pnpm run dev:watch:ai`. This uses real Spanner Graph,
Gemini through Agent Platform, and Agent Platform Memory Bank; Postgres, Temporal, Firebase Auth and
Storage emulators, and provider fixtures remain local. Stop it with
`pnpm run dev:watch:ai:down`.

The base seed does not invoke the real AI/data-plane adapters. After the stack
is ready, run `pnpm run seed:watch:ai` to manually start the separate AI seed;
it reuses the existing artifact and Source Ingestion pipeline.

To run the same four service images against managed production-like
dependencies, copy `.env.local.prod.example` to `.env.local.prod`, fill in
real non-committed values, then run:

```bash
pnpm dev:local:prod
```

This mode requires real Application Default Credentials, Cloud SQL/Postgres,
Temporal Cloud, Identity Platform, Cloud Storage, Spanner, Agent Platform Memory
Bank, and Gemini access. It has no Firebase emulator, local Temporal server,
local database, or mock data-plane fallback. Stop it with
`pnpm dev:local:prod:down`.

For the same managed dependencies with live reload, use:

```bash
pnpm dev:watch:prod
```

This uses `compose.watch.prod.yaml`, keeps the application containers in watch
mode, and does not start local emulators, local Postgres, Temporal dev server,
or mock data-plane services. Stop it with
`pnpm dev:watch:prod:down`.

To manually run the AI seed against the configured demo organization, use
`pnpm run seed:watch:prod` followed by `pnpm run seed:watch:prod:ai` after the
managed services are ready. Set `DEMO_SEED_OWNER_EMAIL` to create an invite
that links a verified real Google/Firebase identity on first sign-in; the seed
does not create a hosted Firebase user itself.

Terraform does not run the application locally. It provisions cloud resources
and references container images; Docker Compose is the local orchestration
layer. The four deployable services have Dockerfiles, while Postgres and
Temporal use their official development images.

For a full validation pass:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r build
pnpm -r test
```

Application-specific environment variables and local startup details live in
the relevant app `.env.example` files, [`docs/operations.md`](docs/operations.md),
and [`docs/demo.md`](docs/demo.md).
Never commit generated env files or cloud credentials.

## Development expectations

- Keep provider integrations behind typed adapters and domain-defined ports.
- Validate all external input, including webhooks, model output, and MCP tool results.
- Use organization-scoped authorization, least-privilege Google Cloud identities, and Secret Manager for secrets.
- Keep agent tools narrow, bounded, observable, and read-only unless an explicit approval flow exists.
- Preserve source IDs, timestamps, freshness, and evidence with every insight.
- Use structured logs, trace IDs, agent-run IDs, and redaction. Do not log secrets or chain-of-thought.
- Prefer synthetic or authorized data for local development.

See [`AGENTS.md`](AGENTS.md) for the full contribution and engineering guide.

## Deployment scaffold

The initial infrastructure blueprint lives in [`infra/`](infra/) and is intentionally opt-in. It does not contact GCP or deploy anything until Terraform is explicitly initialized and applied with project-specific variables. Infrastructure and deployment guidance lives in [`docs/operations.md`](docs/operations.md); use `infra/bootstrap/` for the remote state bucket and dedicated infrastructure deployer.

## License

This repository is proprietary and is available only for authorized private evaluation. It is not licensed for copying, forking, redistribution, reuse, derivative works, or commercial use. See [`LICENSE`](LICENSE).
