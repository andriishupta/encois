# Repository scripts

The root `package.json` contains only repeatable entry points for daily
development, Docker Compose environments, formatting/hooks, and workspace
quality checks. Package-specific commands stay in the owning package and are
run with `pnpm --filter`.

## Supported root commands

| Area | Commands |
| --- | --- |
| Local development | `dev`, `dev:api-gateway` (the dev servers compile required workspace packages through lifecycle hooks, without rewriting generated sources) |
| Compose | `dev:watch:mock`, `dev:watch:mock:down`, `dev:watch:ai`, `dev:watch:ai:down`, `dev:watch:ai:rebuild`, `dev:watch:prod`, `dev:watch:prod:down`, `dev:local:prod`, `dev:local:prod:down` |
| Demo seeding | `seed:watch:ai`, `seed:watch:prod`, `seed:watch:prod:ai`, `seed:local:prod`, `seed:local:prod:ai` |
| Workspace quality | `build`, `lint`, `typecheck`, `test`, `biome:check`, `biome:format`, `biome:write` |
| Formatting and hooks | `format:staged`, `checks:staged`, `stage:formatted`, `go:format`, `go:check`, `hooks:install` |
| Operator/release | `local:onboarding`, `version:check` |

The `local:onboarding` command is the local Firebase Auth Emulator entry point.
After deleting workspace `dist` directories, start the API once so its
`predev` hook compiles the required packages. It requires explicit
`DATABASE_MIGRATION_URL`, `FIREBASE_AUTH_EMULATOR_HOST`, `--email`, and
`--password` values; local defaults are intentionally not hidden in a second
wrapper. API operator commands are package-owned and use the explicit form
`pnpm --filter @encois/api-gateway run <command> -- <options>`. These include
`auth:bootstrap-organization`, `auth:invite-user`, and `auth:list-waitlist`.

Demo seed commands are manual where they can call real cloud services. Their
required order, environment variables, local accounts, and hosted invitation
flow are documented in [`demo.md`](demo.md).

## Adding a script

Add a script only when it is a named, repeatable workflow used by developers,
CI, deployment, or a running container. Prefer a direct command for a one-off
Docker operation, migration, smoke check, or package tool. Keep the command in
the smallest owning `package.json`, document it where it is used, and remove
the entry when its caller is removed. Do not add aliases just to shorten a
command that is already clear in the documentation.

CI-only helpers may remain under `scripts/` without a root package alias when
CI invokes them directly.

## Physical script directories

- `scripts/` — Compose version wrapper, staged hooks, Go checks/formatting,
  release-version helpers, and the CI-only Temporal smoke harness.
- `apps/api-gateway/scripts/` — operator commands and the Compose seed entry
  points. Shared parsing and local control-plane helpers are internal modules,
  not standalone commands.
- `packages/contracts/scripts/` — permission generation and contract parity
  checks used by the package build/test lifecycle.
- `packages/database/scripts/` — migration generation, schema verification,
  and the protected retention cleanup used by the Cloud Run Job.
- `apps/agent-gateway/` and `apps/agent-runtime/` — Go modules with no separate
  script directory; root Go commands cover both modules.

Each retained physical script has a concrete caller. One-off local migration,
fixture reset, verification, and smoke commands are not duplicated as root
aliases.
