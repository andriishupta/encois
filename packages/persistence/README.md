# Encois persistence

This package owns the Gateway API's PostgreSQL schema, Drizzle migrations, runtime database client, and organization transaction context. The Go Agent Runtime and private Agent Gateway must not connect to this database.

## Database URLs

- `DATABASE_MIGRATION_URL` — privileged migration connection, used only by CI/deployment or an operator.
- `DATABASE_RUNTIME_URL` — `api_gateway_runtime` connection, used by the API. It must not be the Cloud SQL admin or migration user.

The runtime role receives `SELECT`, `INSERT`, and `UPDATE` on application tables. It has no `DELETE`, `TRUNCATE`, schema, role-management, or table-management privileges. `withOrganizationContext` sets `app.organization_id` with `SET LOCAL` inside a transaction so RLS policies can provide defense in depth.

## Commands

```bash
DATABASE_MIGRATION_URL=... pnpm --filter @encois/persistence db:migrate
pnpm --filter @encois/persistence typecheck
```

The initial migration is generated from `src/schema` and then extends the generated DDL with role grants, RLS policies, and system role seeds. It must be reviewed like application code.
