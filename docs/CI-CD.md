# Encois CI/CD blueprint

**Status:** parallel repository CI, local synthetic smoke, immutable production image publishing, and a manual Terraform deployment with public-edge smoke are implemented; hosted delivery still requires configured GitHub/GCP credentials and a real environment.

This document describes how the current repository can move from local development to a repeatable Google Cloud deployment without turning Terraform into an application runner or putting long-lived GCP keys in GitHub.

## Current application map

| Component | Current state | Build/deploy unit | Runtime destination |
| --- | --- | --- | --- |
| `apps/dashboard` | React/Vite SPA | Static frontend container | Public Cloud Run service behind `/dashboard/*` |
| `apps/api-gateway` | TypeScript/Hono API | Node.js container | Public Cloud Run service behind `/api/*` |
| `packages/database` | Drizzle/PostgreSQL schema and migrations | No standalone service; migration command | Cloud SQL PostgreSQL |
| `apps/agent-runtime` | Go/Temporal/ADK worker scaffold | Go worker container | Private Cloud Run service, hosted smoke pending |
| `apps/agent-gateway` | Go private tool/policy broker scaffold | Go service container | Internal Cloud Run service, hosted smoke pending |
| `infra/` | Terraform GCP blueprint | Infrastructure plan/apply | GCP project and shared services |

The repository CI now validates the Node services, Go workers, database layer, Terraform, Compose configuration, and all container builds. Hosted rollout remains manual until Temporal, secrets, image promotion, and GitHub/GCP identity are configured.

## Release version source

The root [`package.json`](../package.json) is the release-version source of truth. The current version is `1.0.0`; `pnpm version:check` verifies that every workspace package uses the same value. Go modules keep their normal module metadata and do not define a separate service release version. Go and Node images receive the shared version through the `ENCOIS_VERSION` build argument, the OCI image label, and the `ENCOIS_VERSION` runtime environment variable.

CI tags images as `encois/<service>:<package-version>`. Local Compose uses the same version by default and allows an explicit override with `ENCOIS_VERSION=...`; watch-mock, watch-prod, and local-prod use different image prefixes so their development and production-style images do not collide. Reusing and overwriting `1.0.0` is accepted for the current stage. Once rollback and compatibility guarantees matter, protect version tags and publish immutable commit/digest tags instead.

## Recommended approach

Use a hybrid model:

1. **Local bootstrap:** an authorized operator creates the GCP project/billing setup, Terraform state bucket, deployer identity, and first demo environment.
2. **GitHub Actions CI:** `.github/workflows/ci.yml` runs deterministic TypeScript and Go checks without cloud mutation, runs the local multi-process Temporal smoke with a pinned Temporal CLI and short-lived worker processes, and applies the SQL migrations to an ephemeral PostgreSQL service. It then runs the database integration suite through a non-superuser runtime role with RLS enabled, plus the API command-receipt harness with separate admin fixture setup and runtime API connections. It does not require GCP credentials or provider APIs.
3. **Manual image publishing:** `.github/workflows/publish-production-images.yml` builds the dashboard, API, Agent Gateway, Agent Runtime, and migration-job images, injects only public Firebase browser configuration into the dashboard build, and pushes an operator-selected immutable tag to Artifact Registry.
4. **Manual production delivery:** `.github/workflows/deploy-production.yml` runs only from `workflow_dispatch`, verifies that the selected images exist and are not tagged `latest`, uses GitHub Environment approval and Workload Identity Federation, applies a reviewed Terraform plan, and smoke-tests the public edge.
5. **Runtime migrations:** Terraform creates a dedicated Cloud Run migration Job with its own service account and Secret Manager reference. `.github/workflows/migrate-production.yml` executes that already deployed immutable job only after a protected Environment approval; migrations are not hidden inside Terraform or the API startup.

GitHub Actions should authenticate to Google Cloud with Workload Identity Federation and GitHub OIDC, not a service-account JSON key. Google documents this as a way for workflows to receive short-lived credentials tied to the repository/workflow identity ([Google WIF deployment pipelines](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [GitHub auth action](https://github.com/google-github-actions/auth)).

## Pipeline stages

### 1. Pull request CI

This stage must not deploy or mutate GCP:

```text
checkout
  -> pnpm install --frozen-lockfile
  -> parallel Node package lint/type/test jobs
  -> parallel Go fmt/vet/test jobs
  -> parallel Drizzle/PostgreSQL, Terraform, and Compose checks
  -> local Temporal execution smoke
  -> TypeScript workspace build
  -> parallel Docker image builds without pushing
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

For local commits, install the tracked pre-commit hook once:

```bash
pnpm hooks:install
```

The hook runs Biome formatting/checks only on staged TypeScript files, formats
staged Go files with `gofmt`, and runs no-emit TypeScript checks or `go vet` only
for affected projects/modules. Affected checks run in parallel. It does not run
a full build or tests, and performs one final `git add` only after every job
succeeds. It does not invoke `git commit` or amend an existing
commit, so the current commit message and `git commit -s` sign-off are
preserved.

For manual Biome fixes, use `pnpm biome:write` for formatting and safe fixes.

The `database` CI job starts an ephemeral PostgreSQL service, applies the
privileged Drizzle migrations, creates the restricted `api_gateway_runtime`
role, and checks the command-receipt table, tenant RLS policy, uniqueness
index, restricted grants, and a concurrent duplicate insert race. The
`database` integration suite then verifies migration history, RLS coverage,
`SET LOCAL` organization context reset, cross-tenant read/write isolation,
composite organization foreign keys, tenant-scoped uniqueness, and database
check constraints through the runtime role. Finally, the API HTTP harness uses
the admin role only to seed/remove fixtures and the runtime role for API
requests. It verifies one accepted receipt and one logical Temporal Update ID
application; the two transport attempts are intentional because an
`in_flight` receipt may be replayed safely after an API crash.

The Terraform check should run separately from application checks:

```bash
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra/bootstrap fmt -check -recursive
terraform -chdir=infra/bootstrap validate
```

Because Terraform validation may need provider plugins, CI can run it with a cached plugin directory. It should not receive production credentials for a syntax/type validation job.

### 2. Image build

Build only after all CI checks pass. Each deployable app gets its own image tagged with the workspace release version:

```text
 dashboard:<package-version>
 api-gateway:<package-version>
 agent-runtime:<package-version>
 agent-gateway:<package-version>
```

The current CI build validates images without pushing them. The manual
`publish-production-images.yml` workflow is the controlled promotion step: it
publishes all four deployable images under an operator-selected immutable tag.
The deployment workflow verifies those tags in Artifact Registry and overrides
the image variables in the reviewed Terraform plan, so stale image references
in the protected tfvars secret cannot silently deploy. Dockerfiles and
repeatable container entrypoints exist for all four deployable services; the Go
runtime and Agent Gateway expose internal health endpoints, while the
dashboard/API use their platform server ports.

Build the dashboard image with `VITE_BASE_PATH=/dashboard/` for the hosted
load-balancer path; the local image can keep the default `/` base path. For
real invite-only Google login, also pass the public Firebase web configuration
as `VITE_FIREBASE_*` build arguments. These are browser identifiers, not service
credentials; keep provider secrets and the API runtime configuration outside
the dashboard image. CI also starts the dashboard image and checks `/dashboard/`,
an emitted `/dashboard/assets/*` JavaScript file, and a client-side route so a
path-prefix regression cannot pass as a successful container build.

Self-hosted deployments can set `VITE_PRODUCT_NAME`, `VITE_WORKSPACE_NAME`,
`VITE_PRODUCT_LOGO_URL`, `VITE_PRODUCT_FAVICON_URL`, `VITE_SUPPORT_URL`, and
`VITE_POWERED_BY_VISIBLE` to control the public product brand. Once a user is
authenticated, the organization name returned by the control plane remains the
primary workspace identity.

The CI job runs `bash scripts/smoke-release-local.sh` for the opt-in local
execution smoke. It starts a Temporal dev server and both Go services, checks
the private Agent Gateway `401`/`403` boundary, waits for readiness, runs the
release and approval flows, and cleans up the child processes. The job uses
`temporalio/setup-temporal@v0` with CLI `v1.8.2`; hosted Temporal Cloud and
Cloud Run validation remain a separate deployment check.

The Docker build context is the repository root because the API and dashboard
images consume workspace packages:

```bash
ENCOIS_VERSION="$(node scripts/project-version.mjs)"

docker build -f apps/dashboard/Dockerfile \
  --build-arg ENCOIS_VERSION="$ENCOIS_VERSION" \
  --build-arg VITE_BASE_PATH=/dashboard/ \
  --build-arg VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
  --build-arg VITE_FIREBASE_APP_ID="$VITE_FIREBASE_APP_ID" \
  -t "encois-dashboard:$ENCOIS_VERSION" .
docker build -f apps/api-gateway/Dockerfile --build-arg ENCOIS_VERSION="$ENCOIS_VERSION" -t "encois-api:$ENCOIS_VERSION" .
docker build -f apps/agent-gateway/Dockerfile --build-arg ENCOIS_VERSION="$ENCOIS_VERSION" -t "encois-agent-gateway:$ENCOIS_VERSION" .
docker build -f apps/agent-runtime/Dockerfile --build-arg ENCOIS_VERSION="$ENCOIS_VERSION" -t "encois-agent-runtime:$ENCOIS_VERSION" .
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
  pnpm --filter @encois/database db:migrate
```

The migration connection is operator/CI-only. The API uses `DATABASE_RUNTIME_URL` and the restricted runtime role described in [`docs/GCP.md`](GCP.md). Never put either value in Terraform variables, image layers, logs, or GitHub repository files.

For hosted production, Terraform also creates `${name_prefix}-migrations` as a
Cloud Run Job. Set `migration_image` to the immutable `migrations:<tag>` image
and populate the `cloud-sql-migration-url` Secret Manager secret with a URL
that uses the Cloud SQL Unix socket mounted at `/cloudsql`; the migration URL
must use a separate DDL-capable operator role. The API service account is not
used by this job and keeps its restricted runtime role. Run the protected
`migrate-production.yml` workflow with the same image tag after the
infrastructure rollout and before exposing the new API behavior.

The release also publishes a separate `retention:<tag>` image for the
tenant-scoped cleanup Job. Terraform creates the Job and one Cloud Scheduler
target per UUID in `retention_organization_ids`; it uses the separate
`cloud-sql-retention-url` secret and the `api_gateway_retention` capability
role. The cleanup job is deliberately separate from migrations and the API
runtime, and removes only terminal Runs past their `retention_until` deadline.

For the first release, use additive migrations first, deploy the compatible API, then remove old schema elements in a later change. Database rollback is normally a forward migration, not `terraform destroy` or an automatic down migration.

## Deployment sequence

```text
PR checks
  -> merge to protected branch
  -> build/test dashboard and API images
  -> publish immutable images to Artifact Registry
  -> manual production workflow
  -> Terraform plan with image references
  -> GitHub Environment approval
  -> Terraform apply / Cloud Run revision rollout
  -> protected `migrate-production.yml` executes the matching Cloud SQL Job image
     (the API readiness probe remains 503 until the current schema marker exists)
  -> Cloud Scheduler invokes tenant-scoped retention cleanup on its configured cadence
  -> smoke test public /healthz, dashboard, and API
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
pnpm run dev:watch:mock
```

It runs `compose.watch.mock.yaml` with Postgres, the Temporal development server,
the migration job, API Gateway, Agent Gateway, Agent Runtime, and the Vite
dashboard with live reload. The Runtime is configured with `AGENT_AI_MODE=mock`, so this path is
deterministic and does not require GCP or Gemini credentials. The CI-only
backend acceptance smoke is kept as
`scripts/smoke-release-local.sh`; it is not a replacement for the interactive
Compose stack.

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

- Configure the `production` GitHub Environment and its protected WIF, deployer, state-bucket, and Terraform variable inputs.
- Provision the Artifact Registry repository before the first image-publishing run; Terraform owns the repository, while the publishing workflow assumes the repository already exists.
- The production deploy now gates traffic on `/health/live` and `/health/ready`; the API readiness endpoint fails closed when required production dependencies are missing or the runtime database cannot be reached. The deploy workflow also smoke-tests the public `/healthz`, dashboard, and API edge after rollout. A hosted authenticated workflow smoke remains required after Temporal Cloud and provider credentials are configured.
- Choose local PostgreSQL and Temporal development tooling.
- Configure Workload Identity Federation with repository/branch/environment conditions.
- Reduce the initial Terraform deployer roles and decide whether WIF resources belong in bootstrap or are created manually once.
- Add vulnerability scanning, SBOM, secret scanning, image signing, and dependency update automation.
