# Encois operations

This document covers the supported local environment and the deployment path.
Application-specific variables remain in each app's `.env.example` file.

## Local stack

The local environment is Docker Compose plus the application services:

```text
Dashboard -> Gateway API -> local PostgreSQL
                         -> local Temporal
                         -> local Auth/Storage emulators
Agent Runtime and Agent Gateway -> local Temporal and explicit adapters
```

The normal local demo uses synthetic provider data and explicit mock adapter
modes. It does not fabricate control-plane records in the browser or bypass
Temporal. The local seed creates a populated demo workspace with Integrations,
Sources, Blueprints, Workflows, Runs, events, and real Temporal-backed demo
executions. The full seed requires Temporal and fails closed when it is
unavailable.

Useful entry points:

```bash
pnpm install
pnpm dev
pnpm run local
pnpm run local:down
```

`pnpm dev` starts only the Dashboard; run the API, Runtime, and Agent Gateway
separately for component development. `pnpm run local` is the complete
local vertical slice: Postgres, Temporal, migrations, Auth/Storage emulators,
seed, all four application services, and live reload.

| Service | Local URL |
| --- | --- |
| Dashboard | `http://localhost:5173` |
| Gateway API | `http://localhost:8787` |
| Temporal UI | `http://localhost:8233` |
| Auth emulator UI | `http://localhost:4000` |
| Agent Gateway | `http://localhost:8080` |
| Agent Runtime health | `http://localhost:8090` |

The exact Compose variants and environment variables are defined in the root
`package.json`, Compose files, and application READMEs. The Dashboard, API,
Temporal UI, Auth emulator, and API health endpoints use the ports shown by
the current Compose configuration.

The managed-dependency local profile uses real configured Cloud SQL/Postgres,
Temporal Cloud, Identity Platform, Cloud Storage, Spanner, Memory Bank, and
Gemini access. It has no local database, Temporal server, or mock data-plane
fallback:

```bash
pnpm dev:local:prod
pnpm dev:watch:prod
pnpm dev:watch:prod:down
```

Never commit generated environment files, credentials, service-account keys,
or local database files.

## Demo environments and seeding

The local seed is the populated demo workspace, not a browser fallback or a
parallel product mode. It uses the real API models and Temporal Workflow types.
The base control-plane seed, optional real-AI ingestion, local accounts, hosted
jobs, and invitation flow are documented in [`demo.md`](demo.md).

## Temporal inspection

Temporal is inspected through its UI/CLI and through Gateway projections. A
Run detail page may combine the persisted Run projection with a live Temporal
query, but the two values are not silently merged when they disagree.

For a Run being prepared, the expected sequence is:

```text
PostgreSQL queued Run
  -> outbox row
  -> API preparing projection with the stable Temporal Workflow ID
  -> Coordinator signal
  -> Temporal generic Workflow start
  -> Gateway projection update
```

For waiting or paused Runs, inspect the Workflow history and pending Signals.
For completed or failed Runs, inspect the terminal history and the projected
events/evidence. A stale projection is an operational problem to surface, not
a reason to display a fabricated status.

## Google Cloud baseline

The hosted shape uses:

| Service | Responsibility |
| --- | --- |
| Global HTTPS load balancer | `/dashboard/*` and `/api/*` routing |
| Cloud Run services | Dashboard, Gateway API, Agent Runtime, and Agent Gateway |
| Cloud Run jobs / Cloud Scheduler | migrations, retention, and Integration health dispatch |
| Cloud SQL for PostgreSQL | Gateway control plane |
| Identity Platform | Google identity; Gateway still owns invite and membership authorization |
| Artifact Registry | immutable application and job images |
| Secret Manager | provider credentials and service secrets |
| Cloud Storage | raw payloads and artifacts |
| Spanner Graph | organization graph and normalized facts |
| Vertex AI / Gemini | model calls |
| Cloud Logging / Trace | structured logs and traces |
| Temporal Cloud | durable execution |

The browser reaches only the public Dashboard/API edge. Agent Gateway routes
are private and require service authentication, organization scope, and policy
checks. Runtime and Agent Gateway service accounts use least privilege.

Terraform in `infra/` is an explicit infrastructure adapter. It does not
create a project, manage Temporal Cloud, start local services, or deploy
automatically. Cloud SQL migrations use a restricted operator connection and
must run before the API relies on the corresponding schema.

## CI/CD

The repository already contains:

- `ci.yml` for Node/Go quality checks, database integration checks, Terraform
  validation, Compose validation, local smoke checks, and container builds;
- manual immutable production image publishing;
- manual production Terraform deployment with Workload Identity Federation;
- separate manual production migration and retention workflows.

The delivery boundary keeps these stages separate:

1. Pull request checks: formatting, typechecking, lint, contract checks, and
   targeted tests.
2. Immutable image builds for Dashboard, Gateway API, Agent Gateway, and Agent
   Runtime.
3. Push images to Artifact Registry with a commit or release identifier.
4. Review infrastructure changes and database migrations.
5. Apply to a non-production environment, run the narrow smoke path, then
   require an explicit approval for production.
6. Run migrations with a dedicated operator identity, then deploy services.
7. Verify health/readiness, Temporal reachability, and the demo vertical slice.

GitHub Actions uses Workload Identity Federation/OIDC rather than a long-lived
service-account key. Cloud Build/Cloud Deploy remains a future replacement
when GCP-native promotion and staged rollout become useful. It must preserve
immutable images, approval gates, restricted logs, and a rollback path.

## Secrets and data

Secrets are loaded from local uncommitted environment files or the deployment
secret manager. They are never returned to the Dashboard, agent model, logs,
Terraform state, or public artifacts. Demo data is synthetic or authorized and
has explicit retention and cleanup rules.

## Operational checklist

Before a hosted demo:

- apply the current database migrations with the operator connection;
- configure Temporal namespace/task queues and Runtime connectivity;
- configure Identity Platform and organization membership;
- configure private service authentication between Runtime, Agent Gateway,
  and Gateway API;
- configure provider credentials through Secret Manager;
- verify Cloud Storage, Spanner Graph, Memory Bank, and Gemini modes;
- verify readiness endpoints and structured logs;
- run the scoped demo seed only against the intended demo workspace;
- confirm that Temporal history, outbox delivery, and Gateway projections agree.
