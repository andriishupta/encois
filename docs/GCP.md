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

## Cloud SQL and Drizzle

`packages/persistence` owns the PostgreSQL schema and migrations. The API runtime and migration runner use different connections:

- `DATABASE_MIGRATION_URL` — privileged, operator/CI-only connection for DDL and migrations;
- `DATABASE_RUNTIME_URL` — runtime connection for `api_gateway_runtime`.

The initial migration creates the `api_gateway` capability role as `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`. It grants only `SELECT`, `INSERT`, and `UPDATE` on application tables. It does not grant row deletion, truncation, schema changes, table changes, or role management. A separate login role can inherit this capability role, or Cloud SQL IAM database authentication can be used.

The migration enables PostgreSQL RLS on tenant-scoped tables. The API must execute tenant-scoped work inside `withOrganizationContext`, which sets `app.organization_id` with `SET LOCAL` inside a transaction. RLS is defense in depth; deterministic authorization in the Gateway remains mandatory.

## Initial control-plane entities

- `users` — Identity Platform subject and minimal profile projection; no provider tokens.
- `organizations` — tenant root.
- `organization_units` — organization, department, team, and project hierarchy.
- `roles`, `role_permissions` — system/custom role definitions and permissions.
- `organization_memberships`, `membership_scopes` — user membership and effective hierarchy scope.
- `integrations`, `integration_bindings` — one organization integration bound to many organization units/projects.
- `webhook_endpoints`, `webhook_deliveries` — verified endpoint configuration and idempotent receipt projection.
- `workflow_definitions`, `workflow_runs`, `workflow_events` — approved workflow definitions plus safe Temporal execution projections.
- `idempotency_keys` — organization-scoped request deduplication.
- `audit_events` — security-relevant user/system actions, separate from debug logs.

Large input/output data is represented by references such as `input_ref`, `result_ref`, `payload_ref`, or `evidence_ref`; raw payloads do not belong in SQL rows or Temporal history.

## Cloud Storage

Use Cloud Storage for raw provider snapshots, uploaded files, and large investigation artifacts. Object keys must include environment and organization scope, for example:

```text
{environment}/org/{organizationId}/workflows/{workflowId}/artifacts/{artifactId}
```

The Gateway authorizes access and issues short-lived signed URLs. Buckets remain private, credentials stay in Secret Manager/ADC, and lifecycle retention is configured per environment. Redis is not used as a source of truth for files, workflows, authorization, or tenant data.

## Temporal client boundary

The API Gateway owns the north-south Temporal client boundary, not the worker
implementation. Its TypeScript adapter uses a shared lazy `Connection` and
`Client`, starts executions on the configured task queue, and reads execution
metadata by workflow ID. The Go application polls the same task queue and owns
workflow code and Activities. Temporal credentials belong in Secret Manager or
the deployment secret integration; they are not browser configuration.

For local development, an in-memory adapter is selected when
`TEMPORAL_ADDRESS` is unset. This is a test/development projection only and
must not be used for production or cross-instance coordination.

## Deferred decisions

- Cloud SQL regional/HA tier and private IP topology.
- Cloud SQL IAM database authentication versus Secret Manager password for the runtime login role.
- Cloud Storage bucket retention, deletion, and customer data residency policy.
- Redis product and topology for rate limits, cache, and short-lived locks.
- Identity Platform tenant model and enterprise SAML/OIDC provider configuration.
- Cloud Run deployment manifests, service accounts, and CI/CD promotion flow.
