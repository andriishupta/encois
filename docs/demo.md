# Encois demo guide

This is the canonical guide for creating and operating the populated Encois
demo workspace. Demo fixtures are synthetic, but they use the real control
plane, contracts, Temporal Workflow types, and application pipelines.

The demo is populated in two explicit stages:

1. The base seed creates the PostgreSQL control-plane workspace and its
   Temporal-backed demo executions.
2. The optional AI seed sends selected seeded Sources through the existing
   Source Artifact Store and Source Ingestion Workflow. Agent Runtime and Agent
   Gateway then perform the configured Spanner and Memory Bank writes.

The AI seed is manual because it uses real cloud resources and can incur cost.
Neither seed runs implicitly when a hosted application service restarts.

## Seeded workspace

The base seed creates the `organization-sun` workspace by default, including:

- organizational units, users or a service actor, permissions, and activity;
- six Integrations and fifteen Sources with varied health and freshness;
- approved Blueprint snapshots and thirty Workflow Runs;
- six running, six waiting, eight completed, five paused, and five failed
  Temporal-backed executions;
- one long-lived organization Coordinator Workflow.

The base seed does not call Gemini or populate Spanner and Memory Bank. Run the
AI seed when those real data-plane records are required for the demo.

## Local mock demo

Start the complete local stack:

```bash
pnpm run dev:watch:mock
```

The base seed runs automatically after migrations and Temporal are ready. The
mock profile does not require Google Cloud credentials.

| Surface | Address |
| --- | --- |
| Dashboard | `http://localhost:5173` |
| Gateway API | `http://localhost:8787` |
| Temporal UI | `http://localhost:8233` |
| Firebase Emulator UI | `http://localhost:4000` |

Useful local identities are created only in the Firebase Auth Emulator:

| Purpose | Email | Password |
| --- | --- | --- |
| Organization owner | `owner@local.test` | `local-password-1234` |
| Manager scope | `manager@local.test` | `local-manager-1234` |
| Development manager scope | `dev@local.test` | `local-dev-1234` |
| Viewer scope | `viewer@local.test` | `local-viewer-1234` |
| Onboarding | `onboarding1@local.test` | `local-onboarding-1` |

Stop and remove this stack with:

```bash
pnpm run dev:watch:mock:down
```

## Local demo with real AI services

Copy `.env.local.ai.example` to the uncommitted `.env.local.ai`, configure
Application Default Credentials, Spanner, Memory Bank, and the Gemini project,
then start the stack:

```bash
pnpm run dev:watch:ai
```

The base seed runs automatically. After the Dashboard, API Gateway, Agent
Gateway, and Agent Runtime are ready, start the AI seed manually:

```bash
pnpm run seed:watch:ai
```

The same manual Compose service can be started with Play in Docker Desktop.
`LOCAL_AI_SEED_SOURCE_LIMIT` defaults to `5`; set it to `15` in
`.env.local.ai` to ingest every seeded Source. A completed revision is
idempotent. Set a new `LOCAL_AI_SEED_REVISION`, such as `ai-demo-v2`, to run a
new ingestion intentionally.

## Hosted or production-like demo

Use `.env.local.prod.example` as the configuration checklist. At minimum, the
environment needs:

- migrated Cloud SQL/PostgreSQL and a restricted `DATABASE_SEED_URL`;
- ready API Gateway, Agent Gateway, Agent Runtime, and Temporal worker;
- Temporal namespace, address, task queue, and credentials;
- one artifact bucket configured identically as `SOURCE_ARTIFACT_BUCKET` and
  `GCP_STORAGE_BUCKET`;
- Spanner database, Memory Bank reasoning engine, Gemini project, and model;
- internal service tokens, capability secret, and control-plane service user.

For managed dependencies with live-reload application containers:

```bash
pnpm run dev:watch:prod
pnpm run seed:watch:prod
pnpm run seed:watch:prod:ai
```

For production-built local containers against the same managed dependencies:

```bash
pnpm run dev:local:prod
pnpm run seed:local:prod
pnpm run seed:local:prod:ai
```

Always run the base seed before the AI seed and only after Runtime and Temporal
are ready. Both commands are manual one-shot Compose jobs.

For a deployed environment, build the API Gateway Dockerfile's `seed` target
and run two explicitly authorized one-shot jobs from that image:

```bash
node dist/scripts/seed-local.js
node dist/scripts/seed-local-ai.js
```

Cloud Run Jobs are the intended hosted execution mechanism. Supply the same
environment values and service identity as the deployed environment, keep the
jobs manual, and do not add a general `SEED=true` application startup flag.

## Invite a real user to the demo organization

For a new hosted demo, set these values before running the base seed:

```dotenv
SEED_ORGANIZATION_SLUG=organization-sun
DEMO_SEED_ORGANIZATION_NAME=Sun Inc
DEMO_SEED_OWNER_EMAIL=owner@example.com
```

Managed seeding creates a pending organization-admin invite, not a Firebase or
Identity Platform user. When that exact verified Google/Firebase email signs
in, the existing invite-acceptance path creates the Encois user and membership.

To invite another user after the organization exists, use the private operator
command with the organization UUID printed by the seed or read from the
control-plane database:

```bash
DATABASE_MIGRATION_URL=... \
pnpm --filter @encois/api-gateway run auth:invite-user -- \
  --email member@example.com \
  --organization-id <organization-uuid> \
  --role member
```

Use `organization_admin` for an administrator. Add `--unit-id <unit-uuid>` only
when the membership must be restricted to a specific unit. The
`auth:bootstrap-organization` command creates a new empty organization; it is
not a replacement for the populated demo seed.

## Operational safeguards

- Point `DATABASE_SEED_URL` at the intended environment and verify
  `SEED_ORGANIZATION_SLUG` before each hosted run.
- Do not target a customer organization. The base seed updates the matching
  demo workspace and its deterministic fixture records.
- Keep `DEMO_SEED_IDENTITY_MODE=none` in managed environments. Hosted human
  identities must come from Identity Platform and the invite flow.
- Limit `LOCAL_AI_SEED_SOURCE_LIMIT` when controlling Gemini, Spanner, and
  Memory Bank cost.
- Keep seed credentials out of application containers and remove or disable
  hosted seed jobs when the demo no longer needs them.
