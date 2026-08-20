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

locals {
  application_service_accounts = {
    dashboard     = google_service_account.dashboard.email
    api           = google_service_account.api.email
    agent_runtime = google_service_account.agent_runtime.email
    agent_gateway = google_service_account.agent_gateway.email
  }
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
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_project_iam_member" "gateway_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_project_iam_member" "api_cloud_sql_client" {
  count = var.enable_cloud_sql ? 1 : 0

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "runtime_spanner_user" {
  count = var.enable_spanner ? 1 : 0

  project = var.project_id
  role    = "roles/spanner.databaseUser"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_project_iam_member" "gateway_spanner_user" {
  count = var.enable_spanner ? 1 : 0

  project = var.project_id
  role    = "roles/spanner.databaseUser"
  member  = "serviceAccount:${google_service_account.agent_gateway.email}"
}
