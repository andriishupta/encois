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
packages/*     domain, contracts, agents, integrations, persistence, observability, config
infra/         Google Cloud deployment configuration
docs/          product, architecture, security, and flow documentation
```

Architecture references:

- [`docs/architecture.md`](docs/architecture.md) — system boundaries, runtime, memory, authorization, and deployment.
- [`docs/system-diagram.md`](docs/system-diagram.md) — living current-state diagram with service boundaries and execution flow.
- [`docs/infra.md`](docs/infra.md) — initial GCP/Terraform deployment blueprint, state, IAM, and rollout procedure.
- [`docs/CI-CD.md`](docs/CI-CD.md) — proposed local/manual, GitHub Actions, and GCP-native CI/CD approaches.
- [`docs/flows.md`](docs/flows.md) — user, integration, investigation, query, permission, recovery, and mandatory onboarding flows.
- [`docs/flows.md#onboarding-readiness-states`](docs/flows.md#onboarding-readiness-states) — canonical onboarding states, route gate, and Coordinator transitions.
- [`docs/contracts.md`](docs/contracts.md) — OpenAPI, JSON Schema, shared DTO rules, and TypeScript/Go boundaries.
- [`docs/contracts.md#organization-onboarding-and-readiness`](docs/contracts.md#organization-onboarding-and-readiness) — onboarding status and API error contract.
- [`docs/protocols.md`](docs/protocols.md) — generic Workflow Blueprint and MCP/ADK/Temporal communication model.
- [`docs/security.md`](docs/security.md) — multi-tenant security, trust boundaries, agent policy, secrets, and execution-scoped capabilities.
- [`docs/memory.md`](docs/memory.md) — current Graph/Workflow Memory/artifact boundaries, scope semantics, and provider-neutral future adapters.
- [`docs/GCP.md`](docs/GCP.md) — selected Google Cloud services, Cloud SQL/Drizzle, Identity Platform, storage, and deferred infrastructure decisions.
- [`docs/local.md`](docs/local.md) — complete local Compose, Auth Emulator, onboarding, and reset flow.
- [`docs/dictionary.md`](docs/dictionary.md) — canonical meanings for Worker, Workflow, Activity, Agent, Integration, MCP, and related terms.

## Prerequisites

- Node.js current LTS compatible with pnpm 11.
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
pnpm run onboarding -- \
  --organization "OB Onboarding Demo" \
  --email "ob+1@local.test" \
  --password "local-onboarding-1"
```

Use `auth:invite-user` for later members and `auth:list-waitlist` to review
unknown visitors. These are private operator scripts, not a public management
UI; the waitlist requires work email, company name, and a company website or
LinkedIn URL, but never grants access.

For a faster local onboarding reset, the root command creates a new
organization, pending invite, and Firebase Auth Emulator user using the local
Postgres URL and the default password `local-onboarding-1`:

```bash
pnpm run local:onboarding -- ob+1@local.test
```

The generic execution path can be smoke-tested locally when the Temporal CLI is
installed:

```bash
temporal server start-dev --headless --log-level error
```

In separate terminals, start `apps/agent-gateway` with explicit local mock
mode, `AGENT_GATEWAY_CAPABILITY_SECRET=local-execution-capability-secret`, and
`AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token`, start
`apps/agent-runtime` with explicit `AGENT_AI_MODE=mock` and
`AGENT_MEMORY_MODE=mock`, then run:

```bash
TEMPORAL_ADDRESS=127.0.0.1:7233 \
AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
pnpm smoke:release
```

This exercises API → Temporal → Go Runtime → Agent Gateway → synthetic tools →
API projection. The local harness additionally runs an approval workflow that
waits for an API Signal and resumes in the Go Worker. Both passed locally;
hosted Temporal/Cloud Run smoke is still a deployment step.

With the Temporal CLI installed, `pnpm smoke:release:local` starts the Temporal
dev server and both Go services automatically, waits for readiness, executes
the release and approval smokes, and cleans up the child processes. It defaults
to ports `7234`, `8081`, and `8091` so it can run beside the containerized
local stack; override them with `ENCOIS_SMOKE_TEMPORAL_PORT`,
`ENCOIS_SMOKE_AGENT_GATEWAY_PORT`, and `ENCOIS_SMOKE_AGENT_RUNTIME_PORT` when
those ports are occupied.

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
by an explicit seed script and is not an API execution backend.
The Temporal UI is available at `http://localhost:8233`; the dashboard is at
`http://localhost:5173`; the Firebase Emulator UI is at
`http://localhost:4000`; and the API health endpoints are at
`http://localhost:8787/health/live` and `/health/ready`. Local login uses
`owner@local.test` / `local-password-1234`. Compose uses the local Temporal
stack for workflow execution; the seed script creates explicit organization
and source fixtures but is not selected as an API workflow backend.
See [`docs/local.md`](docs/local.md) for the onboarding and database
verification flow. Follow service logs with
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

To reset only the known fixture organizations and Auth Emulator accounts, use
the scoped reset command documented in [`docs/local.md`](docs/local.md). It
does not remove Docker volumes or unrelated local data.

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
the relevant app `.env.example` files and [`docs/local.md`](docs/local.md).
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

The initial infrastructure blueprint lives in [`infra/`](infra/) and is intentionally opt-in. It does not contact GCP or deploy anything until Terraform is explicitly initialized and applied with project-specific variables. Start with [`docs/infra.md`](docs/infra.md), then use `infra/bootstrap/` for the remote state bucket and dedicated infrastructure deployer.

## License

This repository is proprietary and is available only for authorized private evaluation. It is not licensed for copying, forking, redistribution, reuse, derivative works, or commercial use. See [`LICENSE`](LICENSE).
