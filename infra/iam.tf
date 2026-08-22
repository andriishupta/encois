resource "google_service_account" "dashboard" {
  account_id   = "${local.service_id}-dashboard"
  display_name = "Encois ${var.environment} dashboard"
}

resource "google_service_account" "api" {
  account_id   = "${local.service_id}-api"
  display_name = "Encois ${var.environment} Gateway API"
}

resource "google_service_account" "agent_runtime" {
  account_id   = "${local.service_id}-runtime"
  display_name = "Encois ${var.environment} agent runtime"
}

resource "google_service_account" "agent_gateway" {
  account_id   = "${local.service_id}-gateway"
  display_name = "Encois ${var.environment} private Agent Gateway"
}

resource "google_service_account" "migrations" {
  account_id   = "${local.service_id}-migrations"
  display_name = "Encois ${var.environment} database migrations"
}

resource "google_service_account" "retention" {
  account_id   = "${local.service_id}-retention"
  display_name = "Encois ${var.environment} retention cleanup"
}

resource "google_service_account" "operations_scheduler" {
  account_id   = "${substr(local.service_id, 0, 12)}-ops-sched"
  display_name = "Encois ${var.environment} operations Scheduler"
}

resource "google_service_account" "integration_health" {
  account_id   = "${substr(local.service_id, 0, 16)}-health"
  display_name = "Encois ${var.environment} integration health dispatcher"
}

locals {
  application_service_accounts = merge(
    var.enable_dashboard ? { dashboard = google_service_account.dashboard.email } : {},
    var.enable_api ? { api = google_service_account.api.email } : {},
    var.enable_agent_runtime ? { agent_runtime = google_service_account.agent_runtime.email } : {},
    var.enable_agent_gateway ? { agent_gateway = google_service_account.agent_gateway.email } : {},
    var.enable_cloud_sql ? { migrations = google_service_account.migrations.email } : {},
    var.enable_cloud_sql ? { retention = google_service_account.retention.email } : {}
  )
}

resource "google_project_iam_member" "log_writer" {
  for_each = local.application_service_accounts

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "trace_agent" {
  for_each = local.application_service_accounts

  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "runtime_vertex_user" {
  count = var.enable_agent_runtime ? 1 : 0

  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_project_iam_member" "api_cloud_sql_client" {
  count = var.enable_cloud_sql ? 1 : 0

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "migrations_cloud_sql_client" {
  count = var.enable_cloud_sql ? 1 : 0

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.migrations.email}"
}

resource "google_project_iam_member" "retention_cloud_sql_client" {
  count = var.enable_cloud_sql ? 1 : 0

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.retention.email}"
}

resource "google_project_iam_custom_role" "api_connector_secret_broker" {
  count = var.enable_api ? 1 : 0

  project     = var.project_id
  role_id     = "${local.service_id}_connector_secret_broker"
  title       = "Encois connector secret broker"
  description = "Create connector and webhook Secret Manager containers, add versions, and grant the private Agent Gateway access to the specific connector container."
  permissions = [
    "secretmanager.secrets.create",
    "secretmanager.secrets.get",
    "secretmanager.secrets.getIamPolicy",
    "secretmanager.secrets.setIamPolicy",
    "secretmanager.versions.add",
    "secretmanager.versions.access",
  ]
}

resource "google_project_iam_custom_role" "operations_job_runner" {
  count = length(var.retention_organization_ids) > 0 || length(var.integration_health_organization_ids) > 0 ? 1 : 0

  project     = var.project_id
  role_id     = "${local.service_id}_ops_job_runner"
  title       = "Encois operations job runner"
  description = "Run only the explicitly managed Cloud Run operations jobs with tenant environment overrides."
  permissions = [
    "run.jobs.run",
    "run.jobs.runWithOverrides",
  ]
}

resource "google_project_iam_member" "api_connector_secret_broker" {
  count = var.enable_api ? 1 : 0

  project = var.project_id
  role    = google_project_iam_custom_role.api_connector_secret_broker[0].name
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "gateway_spanner_user" {
  count = var.enable_spanner && var.enable_agent_gateway ? 1 : 0

  project = var.project_id
  role    = "roles/spanner.databaseUser"
  member  = "serviceAccount:${google_service_account.agent_gateway.email}"
}
