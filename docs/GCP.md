# Encois Google Cloud baseline

**Status:** initial implementation decision  
**Scope:** Gateway API control plane and its first persistence/authentication boundary

Encois uses a Google Cloud-native control plane. The first implementation does not self-host Supabase and does not use a second cloud database provider.

## Selected services

```text
Cloud Run              Hono API Gateway
Identity Platform      human authentication and ID tokens
Cloud SQL PostgreSQL   control-plane relational state
Drizzle ORM            typed schema and migrations
Cloud Storage          raw provider payloads and large artifacts
Secret Manager         database and integration credentials
Temporal Cloud         durable workflow execution
Redis                  deferred cache/rate-limit/ephemeral coordination layer
```

The browser calls the Gateway API. It does not connect directly to Cloud SQL, Cloud Storage, Temporal, or provider APIs.

## Identity Platform boundary

Identity Platform authenticates the person and issues an ID token. The Gateway verifies the token with the Firebase Admin SDK using Google Application Default Credentials. Cloud Run supplies ADC through the service identity, so a service-account JSON key is not required in deployment. Local development can use `gcloud auth application-default login` or an explicitly managed local credential; credentials must not be committed.

The token subject is an external identity reference, not an Encois authorization decision. The database stores it in `users.identity_subject`. The Gateway then resolves the subject to an Encois user, active organization membership, role, and scoped organization units. Organization IDs and roles supplied by the client or token claims are never trusted without a database membership check.

`createIdentityPlatformAuthenticator` is the verification adapter. Its principal resolver remains an explicit application boundary so authentication and organization authorization do not get coupled to Firebase claims.

### Invite-only Google access (MVP)

The browser enables only the Google provider through the Identity Platform /
Firebase client SDK. There is no email/password signup and no self-service
organization creation. An operator uses the Gateway scripts with
`DATABASE_MIGRATION_URL` to create an organization, its root unit, and a
pending invite. The invite stores the normalized email, organization, role,
and optional unit scope; it does not store a password or provider token.

On `/api/v1/auth/me`, the Gateway verifies the ID token, requires the Google
sign-in provider and a verified email, then accepts a matching non-expired
invite in one database transaction. That transaction creates the local user
projection, membership, and scope before marking the invite accepted. An
Identity Platform account without a local invite may exist at Google but has
no Encois membership and can only submit `/api/v1/public/waitlist`.

The first implementation does not need a private management UI. Use
`pnpm --filter @encois/api-gateway auth:bootstrap-organization -- --organization
\"Example\" --email owner@example.com` for the first organization, then
`auth:invite-user` for later members. These commands are operator tooling, not
public HTTP routes. A future Identity Platform blocking function can reject
unknown users at provider sign-up time, but Gateway authorization remains the
required security boundary.

## Cloud SQL and Drizzle

`packages/persistence` owns the PostgreSQL schema and migrations. The API runtime and migration runner use different connections:

- `DATABASE_MIGRATION_URL` — privileged, operator/CI-only connection for DDL and migrations;
- `DATABASE_RUNTIME_URL` — runtime connection for `api_gateway_runtime`.

The initial migration creates the `api_gateway` capability role as `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`. It grants only `SELECT`, `INSERT`, and `UPDATE` on application tables. It does not grant row deletion, truncation, schema changes, table changes, or role management. A separate login role can inherit this capability role, or Cloud SQL IAM database authentication can be used.

The migration enables PostgreSQL RLS on tenant-scoped tables. The API must execute tenant-scoped work inside `withOrganizationContext`, which sets `app.organization_id` with `SET LOCAL` inside a transaction. RLS is defense in depth; deterministic authorization in the Gateway remains mandatory.

## Initial control-plane entities

- `users` — Identity Platform subject and minimal profile projection; no provider tokens.
- `organization_invites` — pre-auth operator-controlled invitations keyed by normalized email; no passwords or provider credentials.
- `waitlist_requests` — bounded contact requests containing a plausible work email, company name, and company website or LinkedIn URL; not an authorization source.
- `organizations` — tenant root.
- `organization_units` — organization, department, team, project, service, and future custom hierarchy nodes.
- `roles`, `role_permissions` — system/custom role definitions and permissions.
- `organization_memberships`, `membership_scopes` — user membership and direct hierarchy roots. The Gateway expands descendants; explicit grant/restriction persistence remains a planned follow-up table, not a client-side rule.
- `integrations`, `integration_bindings` — one organization integration bound to many organization units/projects.
- `webhook_endpoints`, `webhook_deliveries` — verified endpoint configuration and idempotent receipt projection.
- `workflow_definitions`, `workflow_runs`, `workflow_events` — approved workflow definitions plus safe Temporal execution projections.
- `workflow_change_plans` — tenant-scoped typed workflow proposals and explicit approval state.
- `workflow_blueprints` — tenant-scoped approved company-specific Blueprint snapshots materialized from create plans.
- `idempotency_keys` — organization-scoped request deduplication.
- `audit_events` — security-relevant user/system actions, separate from debug logs.

Large input/output data is represented by references such as `input_ref`, `result_ref`, `payload_ref`, or `evidence_ref`; raw payloads do not belong in SQL rows or Temporal history.

## Cloud Storage

Use Cloud Storage for raw provider snapshots, uploaded files, and large investigation artifacts. Object keys must include organization scope; environment isolation is provided by the configured bucket/project, for example:

```text
organizations/{organizationId}/sources/{sourceId}/revisions/{revision}.pdf
{organizationId}/{workflowId}/{artifactId}
```

The Gateway API records scoped artifact references, while the private Agent
Gateway authorizes Runtime reads and performs the Cloud Storage access. The
bucket remains private; no signed URL is exposed in the current slice.
Credentials stay in Secret Manager/ADC, and lifecycle retention is configured
per environment. Redis is not used as a source of truth for files, workflows,
authorization, or tenant data.

Every artifact request declares or receives a retention class. The local
adapter records `ephemeral`, `investigation`, `source_snapshot`, or
`legal_hold`; hosted Cloud Storage lifecycle rules and deletion jobs must enforce
the corresponding TTL before real customer data is enabled.

The current Spanner implementation is a tenant-keyed node/edge projection in
`encois_graph_nodes` and `encois_graph_edges`, queried through the Agent
Gateway. It is the MVP Graph persistence boundary; native property-graph query
syntax can be introduced later without changing the Runtime contract.

## Temporal client boundary

The API Gateway owns the north-south Temporal client boundary, not the worker
implementation. Its TypeScript adapter uses a shared lazy `Connection` and
`Client`, starts executions on the configured task queue, and reads execution
metadata by workflow ID. The Go application polls the same task queue and owns
workflow code and Activities. Temporal credentials belong in Secret Manager or
the deployment secret integration; they are not browser configuration.

For local development, the Agent Gateway and Runtime select in-process mock
data adapters with `AGENT_GATEWAY_DATA_MODE=mock` and
`AGENT_MEMORY_MODE=mock`. Hosted deployments select `gcp`, use ADC, and must
provide the bucket, Spanner database, and Vertex AI Reasoning Engine resource.
The API uses Temporal for workflow execution in every environment. Local
fixture data is created by an explicit seed script and is never selected as an
API workflow backend. Deployments must provide the Temporal address, namespace,
task queue, and credentials required by the configured Temporal environment.

Temporal Namespace policy: the MVP uses one shared Namespace with
organization-prefixed Workflow IDs and Gateway/Agent Gateway authorization.
Namespace selection is a deployment isolation setting, not a substitute for
tenant checks. Dedicated customer profiles may use a dedicated Namespace or a
dedicated GCP project plus Temporal environment.

## Deferred decisions

- Cloud SQL regional/HA tier and private IP topology.
- Cloud SQL IAM database authentication versus Secret Manager password for the runtime login role.
- Cloud Storage bucket retention, deletion, and customer data residency policy.
- Retention and deletion policy for invite email addresses and waitlist contact data.
- Explicit organization-unit grant/restriction tables and permission-admin UI.
- Per-provider freshness budgets and Cloud Scheduler/Temporal Schedule wiring.
- Redis product and topology for rate limits, cache, and short-lived locks.
- Identity Platform tenant model and enterprise SAML/OIDC provider configuration.
- Cloud Run deployment manifests, service accounts, and CI/CD promotion flow.
