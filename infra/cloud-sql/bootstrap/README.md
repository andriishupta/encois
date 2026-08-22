# Cloud SQL bootstrap

The application migration role and the API runtime role are separate by design:

- migration role: owns schema changes and may create/alter tables and policies;
- `api_gateway`: a `NOLOGIN` capability role with `SELECT`, `INSERT`, and `UPDATE` only;
- `api_gateway_runtime`: the login role used by Cloud Run, granted membership in `api_gateway`.
- `api_gateway_retention`: a separate `NOLOGIN` capability role with only the
  tenant-scoped cleanup grants required by the protected retention Job;
- `api_gateway_retention_runtime`: the login role used only by that Job, granted
  membership in `api_gateway_retention`.

Create the login role using a secret supplied outside Git, or use Cloud SQL IAM database authentication. Never put a password in a migration, `.env` committed to the repository, or a service-account JSON file.

Example operator-only bootstrap after the initial migration:

```sql
CREATE ROLE api_gateway_runtime
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  INHERIT
  NOREPLICATION
  NOBYPASSRLS;

GRANT api_gateway TO api_gateway_runtime;
```

Create the retention login separately. It must use a different secret/connection
URL from the API runtime and migration roles:

```sql
CREATE ROLE api_gateway_retention_runtime
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  INHERIT
  NOREPLICATION
  NOBYPASSRLS;

GRANT api_gateway_retention TO api_gateway_retention_runtime;
```

Set the password through Cloud SQL/Secret Manager tooling, not in this file. The initial Drizzle migration creates the `api_gateway` capability role and applies its table/schema grants.
