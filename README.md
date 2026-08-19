# Encois

Encois — Enterprise Context Intelligence System — turns fragmented company activity into organizational intelligence.

It connects signals from systems such as GitHub, Jira, Google Workspace, Stripe, and operational monitoring, then uses specialized agents to understand what changed, why it matters, and what deserves attention. The initial product is read-oriented: observe, correlate, explain, and recommend. It does not autonomously run the company.

## Current status

This repository is an early pnpm/TypeScript monorepo scaffold. The product idea and MVP are described in [`docs/IDEA.md`](docs/IDEA.md). The architecture, runtime/product flows, cross-language contracts, security baseline, and canonical terminology are described in [`docs/architecture.md`](docs/architecture.md), [`docs/flows.md`](docs/flows.md), [`docs/contracts.md`](docs/contracts.md), [`docs/security.md`](docs/security.md), and [`docs/dictionary.md`](docs/dictionary.md). The hackathon constraints and submission checklist are in [`docs/hackaton.md`](docs/hackaton.md).

The first vertical slice should answer a question such as:

> Are we on track for the August 30 release, and what evidence explains the risk?

The intended flow is:

```text
source signals -> normalized facts -> agent investigation -> evidence-backed insight -> dashboard/query
```

## Planned MVP

- A simple dashboard: Company Overview → Teams → Risks → Agent Activity.
- A natural-language query interface for release risk, blockers, velocity changes, and deployment regressions.
- Small integrations for GitHub, Jira or simulated project data, Google Workspace, and one operational source.
- Gemini 3.5+ through Gemini API or Vertex AI.
- Google ADK or another eligible Google agent framework.
- Google Cloud deployment with asynchronous investigation runs, durable state, and observable agent activity.
- Organization-aware context: Company → Department → Team → Project → Person/System.

## Repository layout

The workspace is intentionally small today. As packages are added, use the boundaries described in [`AGENTS.md`](AGENTS.md):

```text
apps/web       React SPA
apps/api       Hono API and webhook ingress
apps/agent-runtime Go Temporal workers and Google ADK agents
packages/*     domain, contracts, agents, integrations, persistence, observability, config
infra/         Google Cloud deployment configuration
docs/          source-of-truth product and hackathon documents
```

Architecture references:

- [`docs/architecture.md`](docs/architecture.md) — system boundaries, runtime, memory, authorization, and deployment.
- [`docs/flows.md`](docs/flows.md) — user, integration, investigation, query, permission, and recovery flows.
- [`docs/contracts.md`](docs/contracts.md) — OpenAPI, JSON Schema, shared DTO rules, and TypeScript/Go boundaries.
- [`docs/security.md`](docs/security.md) — multi-tenant security, trust boundaries, agent policy, secrets, and execution-scoped capabilities.
- [`docs/dictionary.md`](docs/dictionary.md) — canonical meanings for Worker, Workflow, Activity, Agent, Integration, MCP, and related terms.

## Prerequisites

- Node.js current LTS compatible with pnpm 11.
- pnpm 11. The repository declares the expected package-manager family in `package.json`.
- Google Cloud access for the deployed agent path once cloud services are added.

Before the first app is added, pin the Node version in the repository and add the final root scripts. Until then, this repository is only a scaffold and has no runnable web or API app.

## Install and run

From the repository root:

```bash
pnpm install
```

When the workspace apps exist, use the web/API package filters and the Go runtime command:

```bash
pnpm --filter @encois/web dev
pnpm --filter @encois/api dev
go run ./apps/agent-runtime
```

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
- Prefer synthetic or authorized data for local development and the hackathon demo.

See [`AGENTS.md`](AGENTS.md) for the full contribution and engineering guide.

## Deployment and hackathon proof

The target is a small Google Cloud deployment suitable for a demo: a React SPA, Gateway API on Cloud Run, a private Agent Gateway, Temporal Cloud for durable execution, Go Temporal/ADK workers, Vertex AI Memory Bank for scoped agent memory, Spanner Graph for company relationships, and Cloud Storage for raw artifacts. The Gateway API owns any control-plane Postgres/Drizzle schema; the Go runtime receives versioned execution context and data references rather than querying that database.

Before submission, the repository must provide:

1. Reproducible local setup and cloud spin-up instructions.
2. An architecture diagram matching the deployed system.
3. A working demonstration of autonomous or asynchronous agent behavior.
4. Visible proof in the demo that Gemini, the Google agent framework, and Google Cloud are used.
5. A public English demonstration video no longer than four minutes.

The complete requirement digest and readiness checklist are in [`docs/hackaton.md`](docs/hackaton.md).

## License

No project license has been selected yet. Add one before publishing or accepting external contributions.
