locals {
  name_prefix = lower(trim(replace("${var.name_prefix}-${var.environment}", "/[^a-z0-9-]/", "-"), "-"))
  # Service account IDs are limited to 30 characters; the longest suffix is
  # "-dashboard", so keep the shared prefix below that limit.
  service_id = substr(local.name_prefix, 0, 19)

  edge_enabled = var.enable_edge && var.enable_dashboard && var.enable_api && var.domain_name != ""

  common_labels = {
    application = "encois"
    environment = var.environment
    managed_by  = "terraform"
  }

  authorized_domains = distinct(compact(concat(
    ["localhost"],
    var.identity_authorized_domains,
    var.domain_name == "" ? [] : [var.domain_name],
  )))
}
