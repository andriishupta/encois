# Next steps for testing and pre-production

These items improve confidence after the current MVP test path. They are not
required to run the local mock Compose stack.

## Persistence coverage

- Add repository unit tests for organization scoping, idempotent upserts,
  transaction boundaries, and RLS context handling.
- Add negative tests for cross-organization reads/writes, stale revisions,
  duplicate workflow starts, and coordinator outbox lease/retry behavior.
- Run the persistence suite against an ephemeral Postgres instance in CI;
  keep the existing local Compose database path for manual smoke testing.

## Hosted dependency coverage

- Run one smoke workflow against Temporal Cloud with the deployed Go worker.
- Verify ADC/IAM for Identity Platform, Cloud SQL, Cloud Storage, Spanner,
  Vertex AI, and Memory Bank using synthetic data only.
- Add contract tests for live Jira/GitHub adapters when those adapters exist;
  deterministic fixtures remain sufficient for the hackathon MVP.

## Pre-production checks

- Add CI typecheck, lint, unit/integration tests, dependency scanning, secret
  scanning, and a browser smoke test for the invite/login path.
- Run a plan in the target GCP project before the first apply and review the
  IAM, Identity Platform, database, bucket, and deletion-protection changes.
- Record the deployed project, region, revisions, Temporal namespace/task
  queue, database, buckets, model, and rollback procedure for the demo.
