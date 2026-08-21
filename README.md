# Encois

Encois — Enterprise Context Intelligence System — turns fragmented company activity into organizational intelligence.

It connects signals from systems such as GitHub, Jira, Google Workspace, Stripe, and operational monitoring, then uses specialized agents to understand what changed, why it matters, and what deserves attention. The initial product is read-oriented: observe, correlate, explain, and recommend. It does not autonomously run the company.

## How it works

```text
company systems and MCP/API tools
  -> Integration Packs and MCP-shaped tool catalog
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
- [`docs/next-steps.md`](docs/next-steps.md) — current implementation review and prioritized next steps.
- [`docs/infra.md`](docs/infra.md) — initial GCP/Terraform deployment blueprint, state, IAM, and rollout procedure.
- [`docs/CI-CD.md`](docs/CI-CD.md) — proposed local/manual, GitHub Actions, and GCP-native CI/CD approaches.
- [`docs/flows.md`](docs/flows.md) — user, integration, investigation, query, permission, and recovery flows.
- [`docs/contracts.md`](docs/contracts.md) — OpenAPI, JSON Schema, shared DTO rules, and TypeScript/Go boundaries.
- [`docs/protocols.md`](docs/protocols.md) — generic Workflow Blueprint and MCP/ADK/Temporal communication model.
- [`docs/security.md`](docs/security.md) — multi-tenant security, trust boundaries, agent policy, secrets, and execution-scoped capabilities.
- [`docs/GCP.md`](docs/GCP.md) — selected Google Cloud services, Cloud SQL/Drizzle, Identity Platform, storage, and deferred infrastructure decisions.
- [`docs/dictionary.md`](docs/dictionary.md) — canonical meanings for Worker, Workflow, Activity, Agent, Integration, MCP, and related terms.

## Prerequisites

- Node.js current LTS compatible with pnpm 11.
- pnpm 11. The repository declares the expected package-manager family in `package.json`.
- Google Cloud access is only required for the later deployed path, not for the local dashboard/API scaffold.

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

Dashboard routes are protected and do not use the old mock sign-up flow. For
the local scaffold, copy `apps/dashboard/.env.example` to a local env file and
provide a development-only bearer fixture; the login screen can then create a
tab-scoped session. Never put a hosted or production credential in a `VITE_*`
variable. The production Identity Platform/Firebase browser adapter is still a
follow-up before hosted user sign-in.

The generic execution path can be smoke-tested locally when the Temporal CLI is
installed:

```bash
temporal server start-dev --headless --log-level error
```

In separate terminals, start `apps/agent-gateway` with
`AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token`, start
`apps/agent-runtime` with the same token and `AGENT_GATEWAY_URL`, then run:

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
the release and approval smokes, and cleans up the child processes.

Terraform does not run the application locally. It provisions cloud resources
and references container images; it does not replace `pnpm dev`, build Docker
images, or start a local Temporal server. Docker Compose remains deferred; the
four deployable services already have Dockerfiles, and the Go Runtime exposes
health-only `/health/live` and `/health/ready` endpoints.

For a full validation pass:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

The actual environment variables, local emulators, seed data, and deployment commands will be documented here as each app is introduced. Copy `.env.example` to a local environment file when it exists; never commit the resulting file or cloud credentials.

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

No project license has been selected yet. Add one before publishing or accepting external contributions.
