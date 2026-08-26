locals {
  name_prefix = lower(trim(replace("${var.name_prefix}-${var.environment}", "/[^a-z0-9-]/", "-"), "-"))
  # Service account IDs are limited to 30 characters; the longest suffix is
  # "-dashboard", so keep the shared prefix below that limit.
  service_id = substr(local.name_prefix, 0, 19)

  spanner_enabled           = var.enable_spanner || var.use_existing_spanner
  spanner_instance_id       = var.use_existing_spanner ? var.spanner_instance_id : "${local.name_prefix}-context"
  spanner_database_resource = "projects/${var.project_id}/instances/${local.spanner_instance_id}/databases/${var.spanner_database_name}"

  edge_enabled = var.enable_edge && var.enable_dashboard && var.enable_api && var.domain_name != ""

  common_labels = {
    application = "encois"
    environment = var.environment
    managed_by  = "terraform"
  }

  authorized_domains = distinct(compact(concat(
    var.identity_include_localhost ? ["localhost"] : [],
    var.identity_authorized_domains,
    var.domain_name == "" ? [] : [var.domain_name],
  )))
}
