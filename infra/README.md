# Encois infrastructure scaffold

The deployable Terraform root is this directory. `bootstrap/` is a separate, one-time configuration that creates the versioned remote state bucket and a dedicated infrastructure deployer service account.

The root stack uses the checked-in partial GCS backend in `backend.tf`; provide the bootstrap bucket with `-backend-config="bucket=..."` during `terraform init`. It does not create a GCP project, build container images, create Temporal Cloud resources, or create Google OAuth credentials. Secret values remain external inputs. See [`../docs/infra.md`](../docs/infra.md) for the architecture and operating procedure.

Spanner is opt-in. `enable_spanner = true` creates a new provisioned instance;
for a manually created Free Trial instance, keep it false and set
`use_existing_spanner = true` with its `spanner_instance_id`. Terraform then
uses the existing instance/database path and does not manage or delete the
instance.
