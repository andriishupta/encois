# Encois CI/CD blueprint

**Status:** repository CI baseline, local synthetic smoke, and local Compose scaffold implemented; cloud delivery and hosted smoke remain proposed.

This document describes how the current repository can move from local development to a repeatable Google Cloud deployment without turning Terraform into an application runner or putting long-lived GCP keys in GitHub.

## Current application map

| Component | Current state | Build/deploy unit | Runtime destination |
| --- | --- | --- | --- |
| `apps/dashboard` | React/Vite SPA | Static frontend container | Public Cloud Run service behind `/dashboard/*` |
| `apps/api-gateway` | TypeScript/Hono API | Node.js container | Public Cloud Run service behind `/api/*` |
| `packages/persistence` | Drizzle/PostgreSQL schema and migrations | No standalone service; migration command | Cloud SQL PostgreSQL |
| `apps/agent-runtime` | Go/Temporal/ADK worker scaffold | Go worker container | Private Cloud Run service, hosted smoke pending |
| `apps/agent-gateway` | Go private tool/policy broker scaffold | Go service container | Internal Cloud Run service, hosted smoke pending |
| `infra/` | Terraform GCP blueprint | Infrastructure plan/apply | GCP project and shared services |

The first useful pipeline can validate and deploy the dashboard/API. Worker and Agent Gateway jobs can use the repository Dockerfiles now; hosted rollout should wait for a hosted Temporal smoke check and populated secrets.

## Recommended approach

Use a hybrid model:

1. **Local bootstrap:** an authorized operator creates the GCP project/billing setup, Terraform state bucket, deployer identity, and first demo environment.
2. **GitHub Actions CI:** `.github/workflows/ci.yml` runs deterministic TypeScript and Go checks without cloud mutation, runs the local multi-process Temporal smoke with a pinned Temporal CLI and short-lived worker processes, and applies the SQL migrations to an ephemeral PostgreSQL service to verify RLS and command-receipt grants. It does not require GCP credentials or provider APIs.
3. **GitHub Actions delivery:** merges to the protected deployment branch build immutable images, push them to Artifact Registry, run Terraform plan, and wait for an environment approval before apply.
4. **Runtime migrations:** Cloud SQL migrations run as a separate protected step using the migration connection; they are not hidden inside Terraform or the API startup.

GitHub Actions should authenticate to Google Cloud with Workload Identity Federation and GitHub OIDC, not a service-account JSON key. Google documents this as a way for workflows to receive short-lived credentials tied to the repository/workflow identity ([Google WIF deployment pipelines](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [GitHub auth action](https://github.com/google-github-actions/auth)).

## Pipeline stages

### 1. Pull request CI

This stage must not deploy or mutate GCP:

```text
checkout
  -> pnpm install --frozen-lockfile
  -> TypeScript lint/typecheck/test/build
  -> Go fmt/vet/test when Go apps are present
  -> Terraform fmt -check and validate
  -> contract/schema checks
```

The root scripts already cover the TypeScript workspace:

```bash
pnpm install --frozen-lockfile
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

The CI workflow also checks `gofmt`, `go test`, and `go vet` independently for
`packages/contracts`, `apps/agent-gateway`, and `apps/agent-runtime`. This
proves contract/runtime compilation and unit boundaries, but not a hosted
Temporal or Cloud Run execution.

The `persistence` CI job starts an ephemeral PostgreSQL service, applies the
privileged Drizzle migrations, and checks the command-receipt table, tenant RLS
policy, uniqueness index, restricted `api_gateway` grants, and a concurrent
duplicate insert race. It then runs a full API HTTP-route harness against the
same database with two concurrent identical Updates. The harness verifies one
accepted receipt and one logical Temporal Update ID application; the two
transport attempts are intentional because an `in_flight` receipt may be
replayed safely after an API crash.

The Terraform check should run separately from application checks:

```bash
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra/bootstrap fmt -check -recursive
terraform -chdir=infra/bootstrap validate
```

Because Terraform validation may need provider plugins, CI can run it with a cached plugin directory. It should not receive production credentials for a syntax/type validation job.

### 2. Image build

Build only after CI passes. Each deployable app gets its own image and immutable identifier:

```text
 dashboard:<git-sha>
 api-gateway:<git-sha>
 agent-runtime:<git-sha>
 agent-gateway:<git-sha>
```

Images are pushed to the Artifact Registry repository created by `infra/`. The deploy input should use the commit SHA or image digest, never `latest`. Dockerfiles and repeatable container entrypoints exist for all four deployable services; the Go runtime and Agent Gateway expose internal health endpoints, while the dashboard/API use their platform server ports.

Build the dashboard image with `VITE_BASE_PATH=/dashboard/` for the hosted
load-balancer path; the local image can keep the default `/` base path. For
real invite-only Google login, also pass the public Firebase web configuration
as `VITE_FIREBASE_*` build arguments. These are browser identifiers, not service
credentials; keep provider secrets and the API runtime configuration outside
the dashboard image.

The local synthetic execution smoke command is `pnpm smoke:release`; it is
opt-in and expects Temporal, Agent Gateway, and the Go Runtime to be started
separately. `pnpm smoke:approval` exercises the generic approval Signal path.
`pnpm smoke:release:local` provides the repeatable local harness: it starts a
Temporal dev server and both Go services, checks the private Agent Gateway
`401`/`403` boundary, waits for readiness, runs the release and approval smokes,
and cleans up the child processes. The CI job uses
`temporalio/setup-temporal@v0` with CLI `v1.8.2`; hosted Temporal Cloud and
Cloud Run validation remain a separate deployment check.

The Docker build context is the repository root because the API and dashboard
images consume workspace packages:

```bash
docker build -f apps/dashboard/Dockerfile \
  --build-arg VITE_BASE_PATH=/dashboard/ \
  --build-arg VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
  --build-arg VITE_FIREBASE_APP_ID="$VITE_FIREBASE_APP_ID" \
  -t encois-dashboard:dev .
docker build -f apps/api-gateway/Dockerfile -t encois-api:dev .
docker build -f apps/agent-gateway/Dockerfile -t encois-agent-gateway:dev .
docker build -f apps/agent-runtime/Dockerfile -t encois-agent-runtime:dev .
```

### 3. Infrastructure plan

A deployment workflow selects an environment, authenticates with the environment's deployer identity, and runs:

```bash
export TF_STATE_BUCKET="the-bucket-created-by-bootstrap"
terraform -chdir=infra init -migrate-state -backend-config="bucket=$TF_STATE_BUCKET"
terraform -chdir=infra plan \
  -var-file=terraform.tfvars \
  -var="dashboard_image=$DASHBOARD_IMAGE" \
  -var="api_image=$API_IMAGE" \
  -out=tfplan
```

The plan should be visible to a reviewer before apply. Plans can contain sensitive values or resource metadata, so do not publish them to a public artifact or leave them indefinitely in GitHub Actions artifacts. Use short retention and restricted access, or run plan/apply in the same protected environment job.

### 4. Approved apply

Apply should be protected by a GitHub Environment approval for demo/staging initially and production later:

```bash
terraform -chdir=infra apply tfplan
```

The apply identity is separate from Cloud Run runtime identities. It may manage infrastructure, but it must not be injected into application containers. The current `infra/bootstrap` deployer is intentionally powerful; after the resource set stabilizes, reduce it into narrower roles or split IAM changes into a protected bootstrap stack.

### 5. Database migration

Cloud SQL schema migrations are a separate release step:

```bash
DATABASE_MIGRATION_URL="$DATABASE_MIGRATION_URL" \
  pnpm --filter @encois/persistence db:migrate
```

The migration connection is operator/CI-only. The API uses `DATABASE_RUNTIME_URL` and the restricted runtime role described in [`docs/GCP.md`](GCP.md). Never put either value in Terraform variables, image layers, logs, or GitHub repository files.

For the first release, use additive migrations first, deploy the compatible API, then remove old schema elements in a later change. Database rollback is normally a forward migration, not `terraform destroy` or an automatic down migration.

## Deployment sequence

```text
PR checks
  -> merge to protected branch
  -> build/test dashboard and API images
  -> push immutable images to Artifact Registry
  -> Terraform plan with image references
  -> human approval
  -> Terraform apply / Cloud Run revision rollout
  -> run Cloud SQL migration if required
  -> smoke test /health/live, /health/ready, dashboard, and API
  -> record revision, image digest, migration, and run evidence
```

For the Go worker deployment path, add the runtime image and Temporal configuration to the same release now that the worker has health endpoints and bounded Temporal startup. Do not make the API deploy wait for a worker image until the local generic flow smoke test passes.

## Environment model

Use separate GCP projects where practical:

| Environment | Trigger | Approval | State |
| --- | --- | --- | --- |
| Local | Developer commands | None | Local only; no GCP mutation by default |
| Demo/staging | Manual workflow or protected branch | One reviewer | Dedicated project and remote state prefix |
| Production | Protected release/tag | Explicit operator approval | Separate project, deployer, secrets, and state |

Each environment should have its own:

- GCP project or clearly isolated project resources;
- Terraform state prefix and deployer identity;
- Cloud Run runtime service accounts;
- Secret Manager secrets and Temporal namespace credentials;
- Cloud SQL database and migration credentials;
- Artifact Registry image promotion policy.

Do not reuse demo credentials or production data. The hackathon environment should use synthetic or explicitly authorized data.

## Local deployment options

The canonical full local stack is now:

```bash
pnpm dev:local:watch
```

It runs `compose.local.yaml` with Postgres, the Temporal development server,
the migration job, API Gateway, Agent Gateway, Agent Runtime, and the Vite
dashboard with live reload. The Runtime is configured with `AGENT_AI_MODE=mock`, so this path is
deterministic and does not require GCP or Gemini credentials. The existing
`pnpm smoke:release:local` remains the smaller backend acceptance smoke used by
CI; it is not a replacement for the interactive Compose stack.

### Option A — recommended now: local application, manual cloud deploy

Use `pnpm dev` and the API dev command locally. When cloud access is available, an authorized developer can run Terraform locally with ADC or service-account impersonation:

```bash
export TF_STATE_BUCKET="the-bucket-created-by-bootstrap"
terraform -chdir=infra init -migrate-state -backend-config="bucket=$TF_STATE_BUCKET"
terraform -chdir=infra plan -var-file=terraform.tfvars
terraform -chdir=infra apply
```

This is acceptable for the first demo because it is explicit and easy to inspect. It is not ideal as the long-term release process: the operator's laptop becomes part of the deployment path, approvals are less visible, and local credentials/configuration can drift.

### Option B — recommended after the first manual deploy: GitHub Actions

Keep local Terraform for emergency or bootstrap work, but make the normal path:

```text
GitHub PR -> CI -> merge -> build image -> plan -> approval -> apply -> smoke test
```

Use OIDC/WIF, GitHub Environments, immutable images, and a separate deployment service account. This gives the hackathon a reproducible path without requiring a laptop during the demo.

### Option C — GCP-native: Cloud Build, optionally Cloud Deploy

Cloud Build can build, push, and deploy Cloud Run images from repository triggers. Google documents this flow with Docker, Artifact Registry, and `gcloud run deploy` ([Cloud Build to Cloud Run](https://cloud.google.com/build/docs/deploying-builds/deploy-cloud-run)). Cloud Deploy can add staged targets and promotions for Cloud Run services/worker pools ([Cloud Deploy for Cloud Run](https://cloud.google.com/deploy/docs/deploy-app-run)).

This is a reasonable alternative if the project becomes GCP-only. It is less convenient than GitHub Actions for a repository whose source, review, and PR checks live in GitHub, and it should not be introduced before the first working image pipeline.

## Rollback and failure handling

- **Application revision:** roll back to the previous Cloud Run revision or re-apply the previous immutable image digest.
- **Terraform:** revert the Terraform commit and review a new plan; do not use `terraform destroy` for normal rollback.
- **Database:** use a tested forward migration or restore procedure; never assume infrastructure rollback can undo schema changes.
- **Image:** keep old Artifact Registry images long enough to support rollback and set cleanup policies deliberately.
- **Worker:** pause/cancel affected Temporal workflows according to workflow policy before rolling a worker revision back.
- **Secrets:** rotate Secret Manager versions independently; do not rebuild images to rotate credentials.

Every deployment should record the commit SHA, image digests, Terraform plan/apply result, Cloud Run revision, migration ID, and smoke-test result.

## Decisions still pending

- Add GitHub Actions workflow files only after the repository owner creates the GitHub repository and selects the demo project. Environment tfvars should remain outside Git and be provided by protected CI configuration.
- Choose GitHub Actions versus Cloud Build as the canonical image builder.
- Build and scan the four Dockerfiles, then add a deployment smoke test for health/readiness and the synthetic workflow.
- Choose local PostgreSQL and Temporal development tooling.
- Configure Workload Identity Federation with repository/branch/environment conditions.
- Reduce the initial Terraform deployer roles and decide whether WIF resources belong in bootstrap or are created manually once.
- Add vulnerability scanning, SBOM, secret scanning, image signing, and dependency update automation.
