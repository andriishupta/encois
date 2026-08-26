# Encois deployment blueprint

**Status:** initial GCP/Terraform scaffold

This document describes the smallest deployment that can host the Encois dashboard and Gateway API while leaving a clean path for the Go Temporal/ADK workers. It is a blueprint, not a live deployment: no GCP API call is made by creating these files, and no credentials are stored in the repository.

## Current deployment blockers

The Cloud Run scaffold now matches the current Go worker contract: the API
uses `TEMPORAL_ADDRESS`, the worker uses `TEMPORAL_HOST_PORT`, both receive the
Temporal API key from Secret Manager, and the worker exposes internal
`/health/live` and `/health/ready` endpoints. When both private services are
enabled, Terraform also wires the Agent Gateway URL and its separate service
token to the worker and grants each service only the secret it needs. Terraform
also wires the separate execution-capability signing secret to both the Gateway
API and Agent Gateway; neither service can start the production execution path
without that shared Secret Manager value. When the
API and Runtime are enabled together, it also wires the private control-plane
URL, Cloud Run audience, shared application token, and Runtime service-account
invoker grant. Vertex AI mode is enabled with Application Default Credentials;
the Runtime does not need a Gemini API key in Cloud Run.

This is still an infrastructure blueprint, not a verified deployment. The
remaining blockers are built/pushed immutable container images, a real Temporal
Cloud namespace/API key, populated Secret Manager versions, a GCP project, and
a smoke test against the deployed services. The local multi-process synthetic
smoke path has already passed.

The API `/health/ready` endpoint is a real production gate: it returns `503`
until Cloud SQL is reachable, the `organization_onboarding` schema marker from
the latest committed migration exists, and the required Identity Platform, Temporal,
execution-capability, OAuth, artifact, private-service, and HTTPS CORS settings
are present. Local and test profiles retain the non-blocking readiness behavior
needed for the memory-mode development scaffold.

The broader release options are documented in [`docs/CI-CD.md`](CI-CD.md). This file stays focused on the infrastructure resources and their manual bootstrap.

## Target shape

```mermaid
flowchart LR
    DNS[Purchased domain] --> LB[Global HTTPS Load Balancer]
    LB -->|/| Web[Future landing page]
    LB -->|/dashboard/*| Dashboard[Cloud Run dashboard]
    LB -->|/api/*| API[Cloud Run Gateway API]

    User[Browser] --> Identity[Cloud Identity Platform]
    User --> Dashboard
    Dashboard --> API

    API --> Temporal[Temporal Cloud]
    API --> SQL[(Cloud SQL PostgreSQL)]
    Runtime[Cloud Run Go Agent Runtime] -. polls .-> Temporal
    Runtime --> Gateway[Private Agent Gateway]
    Gateway --> Providers[GitHub / Jira / Google / monitoring]
    Runtime --> Gemini[Vertex AI / Gemini]
    Runtime --> Memory[Vertex AI Memory Bank]
    Gateway --> Graph[(Optional Spanner Graph)]
    Gateway --> Objects[(Cloud Storage)]
    Gateway --> Secrets[Secret Manager]
```

The initial public edge is one domain with path routing:

| Path | Target | Exposure |
| --- | --- | --- |
| `/` | Dashboard until a landing-page service is added | Public edge; app auth still applies where needed |
| `/dashboard` and `/dashboard/*` | React dashboard Cloud Run service | Public edge, direct `run.app` ingress blocked |
| `/api/*` and `/healthz` | Hono Gateway API Cloud Run service | Public edge, auth/authorization in the API |
| no public route | Go runtime and Agent Gateway | Internal-only Cloud Run services |

Cloud Run does not perform multi-service path routing by itself. The global external HTTPS Application Load Balancer and regional serverless NEGs provide that routing. The Cloud Run services use `internal-and-cloud-load-balancing` ingress so users cannot bypass the edge through the default service URL.

The React image must be built with `--build-arg VITE_BASE_PATH=/dashboard/` for
the hosted path. Vite assets and TanStack Router now use the same base path;
local development keeps `/` by default. Pass the public Firebase web
configuration as `VITE_FIREBASE_*` build arguments when hosted Google login is
enabled. The dashboard nginx image strips the `/dashboard` routing prefix
before resolving the built files, so `/dashboard/assets/*` and client-side
routes remain valid after the load balancer forwards the original path.
Terraform can route the request, but it cannot rewrite SPA asset URLs or
client-side routes after the image is built.

## Terraform layout

```text
infra/
  bootstrap/              one-time state bucket and infra deployer
  versions.tf             provider and Terraform version constraints
  apis.tf                 enabled Google APIs
  iam.tf                  runtime service accounts and permissions
  artifact_registry.tf    container repository
  cloud_run.tf            dashboard, API, runtime, Agent Gateway
  load_balancer.tf        HTTPS, certificate, path routing, HTTP redirect
  identity.tf             optional Identity Platform config
  cloud_sql.tf            optional Cloud SQL PostgreSQL control plane
  storage.tf              optional raw artifact bucket
  secrets.tf              secret containers, never secret values
  spanner.tf              optional normalized context database
  backend.tf.example      remote-state configuration template
```

The root stack is a GCP adapter. Application code should depend on interfaces such as `ObjectStore`, `SecretProvider`, `WorkflowClient`, and `GraphStore`; only `infra/` should know that the first implementation is Cloud Run, Cloud Storage, Secret Manager, Spanner, and Temporal Cloud. A future AWS/Azure deployment can keep the app contracts and replace the provider-specific Terraform modules and CI wiring. Terraform itself is not a multi-cloud abstraction layer, so portability comes from keeping the provider boundary narrow rather than hiding every cloud feature behind generic variables.

## Local development

Terraform is not a local application runner. It describes cloud infrastructure, creates or updates GCP resources after an explicit `plan/apply`, and points Cloud Run at already-built container images. It does not start the React dev server, Hono API, Go worker, or Temporal server on a laptop.

The currently supported local path is the existing pnpm workspace:

```bash
pnpm install
```

Run the dashboard:

```bash
pnpm dev
```

Run the API in a second terminal:

```bash
pnpm --filter @encois/api-gateway dev
```

Open `http://localhost:5173` for the dashboard and use `http://127.0.0.1:8787/health/live` or `/health/ready` for the API. The API defaults are documented in [`apps/api-gateway/.env.example`](../apps/api-gateway/.env.example). The Compose stack provides PostgreSQL and applies migrations before starting the API.

The canonical full local stack is:

- `pnpm run dev:watch:mock` runs `compose.watch.mock.yaml` with Postgres, the official
  Temporal development image, migrations, Firebase Auth Emulator, the local
  auth seed, all four application services, and the dashboard. The local
  Runtime uses `AGENT_AI_MODE=mock`, the data plane uses local adapters, and
  the dashboard fixture mode is explicit; no Gemini key or GCP credentials are
  required. See [`docs/local.md`](local.md) for the login and onboarding test.

For the existing Go runtime, both paths are supported: the Temporal CLI's
development server for local work, or Temporal Cloud credentials injected
through environment/Secret Manager for a hosted demo. The Runtime starts a
Temporal Worker explicitly, marks `/health/ready` only after the Worker starts,
and reports fatal worker errors through the process health state.

For hosted Runtime → Agent Gateway calls, Cloud Run IAM supplies the Google ID
token whose audience is the Agent Gateway service URL. The Runtime also sends a
separate `X-Encois-Service-Token`; the Gateway validates both layers. Local
development can use the legacy static bearer token without Cloud Run IAM. The
Agent Gateway readiness probe fails closed when the service token is missing,
so a misconfigured revision does not receive Runtime traffic.

For the hackathon, the practical progression is: run the complete local Compose
stack, build immutable images in CI, deploy the same application images to
Cloud Run, and show the hosted Cloud Run/API/agent run evidence in the demo.
Local Docker is useful for reproducibility but is not a substitute for the
required Google Cloud deployment proof.

## What is enabled by default

The safe defaults create only the API/service foundation and secret containers when explicitly applied. Services that require container images, billing, a purchased domain, or billable data stores are opt-in through `terraform.tfvars`:

- Cloud Run service creation is disabled until an immutable image is supplied.
- Identity Platform is disabled until the project has billing, a Google OAuth web client, and the auth policy is confirmed.
- The external load balancer and managed certificate are disabled until DNS is ready.
- Spanner is disabled because a new provisioned instance is billable; an existing manually created Free Trial instance can be selected with `use_existing_spanner` and `spanner_instance_id`. Enabling the Agent Gateway requires the current Graph schema and database IAM bindings.
- Cloud SQL is disabled because it is billable; when enabled it is the control-plane database for Drizzle migrations and API runtime state.
- Cloud Storage is disabled unless a globally unique bucket name is provided. The API uses object-admin access for upload rollback; the Agent Gateway uses separate read/write data-plane access.

The Artifact Registry repository is part of the base stack. Image builds and pushes belong in CI, not in Terraform. Use immutable image tags or digests for deploys; do not use `latest` in production.

## Identity and permissions

There are three distinct permission planes:

1. **Human/application identity:** Cloud Identity Platform authenticates users. The Gateway API verifies the ID token and computes organization scope deterministically. Identity Platform does not replace application authorization.
2. **Runtime identities:** dashboard, API, Agent Runtime, and Agent Gateway each have a separate Google service account. The runtime identities do not share provider credentials.
3. **Infrastructure identity:** `infra/bootstrap` creates a dedicated Terraform deployer service account. It is not used by any Cloud Run container.

The Agent Gateway gets access only to connector Secret Manager containers that the
Gateway API creates for a connected integration. The API uses a small custom
Secret Manager broker role to create the container, add a token version, and
grant the private Gateway service account access to that one container. The Go
runtime gets Vertex AI access and receives only scoped data references. Secret
values are added through the OAuth callback or a protected secret-management
pipeline; Terraform manages platform IAM and static service secrets, not
provider token payloads. The Google OAuth client secret is supplied through a
protected `TF_VAR_google_oauth_client_secret` input and is retained in protected
Terraform state.

Cloud Run services call one another through explicit `api_service_url`,
`agent_runtime_service_url`, and `agent_gateway_service_url` variables. This is
intentional: using computed service URIs in both directions creates a Terraform
dependency cycle. Populate the URLs from the first deployed revision (or the
internal load-balancer URL) before applying the private service wiring.

The bootstrap deployer role list is intentionally explicit, but it includes the powerful `roles/resourcemanager.projectIamAdmin` because the root stack creates service-account IAM bindings. Treat that identity as infrastructure-admin, use short-lived impersonation or Workload Identity Federation, and do not create a JSON key. Once the resource set stabilizes, replace broad predefined roles with a reviewed custom role or split IAM changes into a separately protected bootstrap stack.

## State and deployer workflow

Terraform state contains resource metadata and can contain sensitive values from providers. It must use a private, versioned GCS bucket with restricted IAM. The state bucket has `prevent_destroy = true` in the bootstrap stack.

One-time bootstrap, performed by an authorized operator:

```bash
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
# Edit the project and globally unique state bucket name.
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan
terraform -chdir=infra/bootstrap apply
```

Then configure the main stack:

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Replace project, domain, image, OAuth, and Temporal inputs.
export TF_STATE_BUCKET="the-bucket-created-by-bootstrap"

terraform -chdir=infra init -migrate-state -backend-config="bucket=$TF_STATE_BUCKET"
terraform -chdir=infra validate
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra apply tfplan
```

The commands are intentionally manual and reviewable. Nothing runs automatically from this repository. CI can later run the same plan/apply flow using Workload Identity Federation and an approval gate for production; it should not receive a long-lived service-account key.

## Autoscaling baseline

- Dashboard and API: minimum 1, maximum 2 by default; set minimum to 0 for a low-cost demo environment.
- Agent Runtime: minimum 1, maximum 2. A continuously polling Temporal worker should not scale to zero.
- Agent Gateway: minimum 1, maximum 2 while it is a separate service; it may be in-process for the first vertical slice.
- Runtime concurrency is 1 to avoid uncontrolled parallel agent work. API concurrency is higher and should be tuned from metrics.
- Worker and gateway containers bind the Cloud Run `PORT`; the runtime's HTTP listener is health-only and the lack of a public route does not turn a Cloud Run service into a free-form VM.
- Timeouts, retries, budgets, provider rate limits, and workflow concurrency remain application/runtime policy, not load-balancer policy.

Coordinator outbox delivery is a separate one-shot process in the API image:
`dist/coordinator-dispatcher.js`. It requires
`COORDINATOR_DISPATCH_ORGANIZATION_ID` and is intended to run as a Cloud Run
Job invoked by Cloud Scheduler, one tenant per invocation. The Terraform
scaffold does not create the Job or scheduler because their cadence, tenant
inventory, and deployment IAM are environment-specific; the job must use the
API/runtime service identity and only the required invocation permissions.

Integration health probes use the protected
`POST /api/v1/internal/integrations/health-check` dispatcher. It accepts an
optional `integrationId`; without one it checks up to 50 active GitHub/Jira
integrations in the supplied organization. The API keeps the tenant inventory
and calls the private Agent Gateway, which reads the scoped Secret Manager
credential, performs a bounded provider probe, and reports the lifecycle state
back to the API. Configure one Cloud Scheduler/Cloud Run Job invocation per
organization with `X-Encois-Service-Token` and `X-Organization-ID`; do not put
the service token in Terraform state or a browser request. The repository
provides a protected API-image dispatcher and Terraform creates one Cloud Run
Job/Scheduler target per UUID in `integration_health_organization_ids`. The
tenant inventory remains explicit deployment configuration and the cadence is
controlled by `integration_health_schedule`.

If a provider returns a refresh token, put its HTTPS token endpoint and client
configuration in the server-only `integration-oauth-config` secret. The Agent
Gateway refreshes on expiry or one provider authorization failure, writes a
new Secret Manager version, and retries once. Providers without a compatible
refresh policy transition to `needs_reauth`; no raw token reaches the browser,
API response, or log.

Workflow retention cleanup is a separate protected Cloud Run Job using the
`retention:<tag>` persistence image and `cloud-sql-retention-url`. Terraform
creates one Cloud Scheduler target per UUID in `retention_organization_ids`.
Each execution sets `RETENTION_ORGANIZATION_ID`, applies the PostgreSQL RLS
tenant context, removes only terminal Runs whose `retention_until` has elapsed
(including their command receipts/events), and records a redacted audit event.
Temporal history and large artifacts remain governed by their own retention
policies; they are not silently assumed to be removed by this SQL job.

This is deliberately not Kubernetes. Cloud Run provides revisioned deployments, request-driven scaling, health checks, and rollback without operating a cluster. Temporal Cloud remains the durable workflow engine; Cloud Run is only the execution host for the API and workers.

## Deliberately deferred

- Cloud project creation, billing attachment, organization/folder policy, and DNS registrar changes.
- Temporal Cloud namespace/provider automation; credentials are external secret inputs.
- Google OAuth client creation and rotation; Terraform consumes the protected client inputs but does not create Google Cloud OAuth credentials.
- Cloud Armor, IAP, VPC Service Controls, private egress, and customer-specific data residency.
- Hosted Spanner schema/IAM verification, Memory Bank reasoning-engine setup,
  and provider-specific erasure policy. The application adapters and Terraform
  DDL are present; these items require a real GCP project and a data-retention
  decision for Temporal history, artifacts, and external provider data.
- Cloud SQL private-IP/HA topology, IAM database authentication, and the first migration execution in the target project.
- GitHub Actions/Cloud Build workflow files, vulnerability scanning, SBOM, image signing, and production approval policy.
- Landing-page Cloud Run service. Until it exists, `/` falls back to the dashboard backend.

These are explicit deferred infrastructure decisions after the first vertical slice runs locally.

## References

- [Google Cloud: external Application Load Balancer with serverless NEGs](https://cloud.google.com/load-balancing/docs/https/setting-up-https-serverless)
- [Google Cloud: Cloud Run ingress restrictions](https://cloud.google.com/run/docs/securing/ingress)
- [Terraform Google provider: Identity Platform config](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/identity_platform_config)
