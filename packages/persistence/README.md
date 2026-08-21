# Encois persistence

This package owns the Gateway API's PostgreSQL schema, Drizzle migrations, runtime database client, and organization transaction context. The Go Agent Runtime and private Agent Gateway must not connect to this database.

## Database URLs

- `DATABASE_MIGRATION_URL` — privileged migration connection, used only by CI/deployment or an operator.
- `DATABASE_RUNTIME_URL` — `api_gateway_runtime` connection, used by the API. It must not be the Cloud SQL admin or migration user.

The runtime role receives `SELECT`, `INSERT`, and `UPDATE` on application tables. It has no general `DELETE`, `TRUNCATE`, schema, role-management, or table-management privileges. The Gateway has a tenant-scoped permission-removal exception for `membership_scopes`; authorization is enforced before the delete and RLS remains the database defense in depth. `withOrganizationContext` sets `app.organization_id` with `SET LOCAL` inside a transaction so RLS policies can provide defense in depth.

## Commands

```bash
DATABASE_MIGRATION_URL=... pnpm --filter @encois/persistence db:migrate
DATABASE_MIGRATION_URL=... pnpm --filter @encois/persistence db:verify
pnpm --filter @encois/persistence typecheck
```

The initial migration is generated from `src/schema` and then extends the generated DDL with role grants, RLS policies, and system role seeds. It must be reviewed like application code.

`db:verify` is a non-production verification helper. It checks the command
receipt table, tenant policy, unique command key, restricted runtime grants,
and a concurrent duplicate-insert race. It creates temporary verification rows
and removes them; it does not validate concurrent HTTP/API delivery.

The `workflow_change_plans` table stores typed Coordinator proposals and
approval state. The `workflow_blueprints` table stores approved
company-specific Blueprint snapshots materialized from create plans. Both are
tenant-scoped with RLS and intentionally separate from Temporal history; the
Gateway passes a validated snapshot into a generic Temporal Workflow.

The `coordinator_event_outbox` table is written in the same transaction as
plan approval/application. It stores only small `coordinator-event.v1`
envelopes and an idempotent event ID. The Gateway API contains the bounded
claim/retry and Temporal-sink boundary; a scheduler or Cloud Run job must invoke
it in a deployed environment and mark events delivered. The Go Runtime never
reads this table.

The `workflow_command_receipts` table records tenant-scoped Signal and Update
delivery attempts. A receipt is claimed before the Gateway calls Temporal and
is marked `accepted` only after the Temporal call and audit event succeed.
`in_flight` receipts may be replayed after a process crash; a request-hash
conflict is rejected. Temporal Update IDs and Go Workflow Signal IDs make that
replay safe at the execution boundary.
