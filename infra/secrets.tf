resource "google_secret_manager_secret" "application" {
  for_each = var.secret_names
  depends_on = [
    google_project_service.required["secretmanager.googleapis.com"]
  ]

  secret_id = "${local.name_prefix}-${each.key}"

  replication {
    auto {}
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret_iam_member" "gateway_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_gateway && name == var.agent_gateway_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_secret_manager_secret_iam_member" "gateway_execution_capability_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_gateway && name == var.execution_capability_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_secret_manager_secret_iam_member" "api_gateway_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && var.enable_agent_gateway && name == var.agent_gateway_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_runtime_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && var.enable_agent_runtime && name == var.agent_runtime_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_service_token_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_runtime && name == var.agent_runtime_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_oauth_config_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && name == var.integration_oauth_config_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "gateway_oauth_config_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_gateway && name == var.integration_oauth_config_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_secret_manager_secret_iam_member" "api_oauth_state_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && name == var.integration_oauth_state_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_execution_capability_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && name == var.execution_capability_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_database_accessor" {
  for_each = {
    for name in var.secret_names : name => name
    if var.enable_api && var.enable_cloud_sql && name == "cloud-sql-runtime-url"
  }

  secret_id = google_secret_manager_secret.application[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "migrations_database_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_cloud_sql && name == var.migration_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migrations.email}"
}

resource "google_secret_manager_secret_iam_member" "retention_database_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_cloud_sql && name == var.retention_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.retention.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_temporal_accessor" {
  for_each = {
    for name in var.secret_names : name => name
    if var.enable_agent_runtime && name == var.temporal_secret_name
  }

  secret_id = google_secret_manager_secret.application[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_gateway_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_runtime && name == var.agent_gateway_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "control_plane_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && var.enable_agent_runtime && name == var.control_plane_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "integration_health_control_plane_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && var.enable_agent_gateway && length(var.integration_health_organization_ids) > 0 && name == var.control_plane_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.integration_health.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_control_plane_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_runtime && name == var.control_plane_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "gateway_control_plane_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_gateway && var.enable_api && name == var.control_plane_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_secret_manager_secret_iam_member" "api_temporal_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_api && var.temporal_address != "" && name == var.temporal_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
