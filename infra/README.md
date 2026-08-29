# Encois infrastructure scaffold

The deployable Terraform root is this directory. `bootstrap/` is a separate,
one-time configuration that creates the versioned remote-state bucket, a
dedicated infrastructure deployer service account, and GitHub Workload
Identity Federation. WIF lets GitHub Actions impersonate that account without
storing a service-account JSON key.

The root stack uses the checked-in partial GCS backend in `backend.tf`. Provide
the bootstrap bucket with `-backend-config="bucket=..."` during `terraform
init`. Terraform does not create a GCP project, build images, create Temporal
Cloud resources, or create Google OAuth credentials. Secret values remain
external inputs.

A custom domain is optional. With `enable_edge = false` and an empty
`domain_name`, the dashboard and Gateway API use their standard public Cloud
Run `run.app` URLs. Agent Runtime and Agent Gateway use IAM-protected `run.app`
URLs. Set `enable_edge = true` only when a custom hostname and managed HTTPS
load balancer are required.

See [`../docs/operations.md`](../docs/operations.md) for the deployment and
operating procedure.

Spanner is opt-in. `enable_spanner = true` creates a new provisioned instance;
for a manually created Free Trial instance, keep it false and set
`use_existing_spanner = true` with its `spanner_instance_id`. Terraform then
uses the existing instance/database path and does not manage or delete the
instance.
