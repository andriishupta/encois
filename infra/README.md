# Encois infrastructure scaffold

The deployable Terraform root is this directory. `bootstrap/` is a separate, one-time configuration that creates the versioned remote state bucket and a dedicated infrastructure deployer service account.

The root stack is intentionally conservative: it does not create a GCP project, does not build container images, does not create Temporal Cloud resources, and does not contain any secret values. See [`../docs/infra.md`](../docs/infra.md) for the architecture and operating procedure.

