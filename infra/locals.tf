data "google_project" "current" {
  project_id = var.project_id
}

locals {
  name_prefix = lower(trim(replace("${var.name_prefix}-${var.environment}", "/[^a-z0-9-]/", "-"), "-"))
  # Service account IDs are limited to 30 characters; the longest suffix is
  # "-dashboard", so keep the shared prefix below that limit.
  service_id = substr(local.name_prefix, 0, 19)

  spanner_enabled           = var.enable_spanner || var.use_existing_spanner
  spanner_instance_id       = var.use_existing_spanner ? var.spanner_instance_id : "${local.name_prefix}-context"
  spanner_database_resource = "projects/${var.project_id}/instances/${local.spanner_instance_id}/databases/${var.spanner_database_name}"

  edge_enabled = var.enable_edge && var.enable_dashboard && var.enable_api && var.domain_name != ""

  cloud_run_host_suffix     = "${data.google_project.current.number}.${var.region}.run.app"
  dashboard_service_url     = "https://${local.name_prefix}-dashboard-${local.cloud_run_host_suffix}"
  api_service_url           = var.api_service_url != "" ? trimsuffix(var.api_service_url, "/") : "https://${local.name_prefix}-api-${local.cloud_run_host_suffix}"
  agent_runtime_service_url = var.agent_runtime_service_url != "" ? trimsuffix(var.agent_runtime_service_url, "/") : "https://${local.name_prefix}-runtime-${local.cloud_run_host_suffix}"
  agent_gateway_service_url = var.agent_gateway_service_url != "" ? trimsuffix(var.agent_gateway_service_url, "/") : "https://${local.name_prefix}-gateway-${local.cloud_run_host_suffix}"
  dashboard_application_url = local.edge_enabled ? "https://${var.domain_name}/dashboard" : local.dashboard_service_url
  api_public_url            = local.edge_enabled ? "https://${var.domain_name}" : local.api_service_url

  common_labels = {
    application = "encois"
    environment = var.environment
    managed_by  = "terraform"
  }

  authorized_domains = distinct(compact(concat(
    var.identity_include_localhost ? ["localhost"] : [],
    var.identity_authorized_domains,
    var.enable_identity_platform ? ["${var.project_id}.firebaseapp.com"] : [],
    var.domain_name == "" ? [] : [var.domain_name],
    var.enable_dashboard && !local.edge_enabled ? [trimprefix(local.dashboard_service_url, "https://")] : [],
  )))
}
