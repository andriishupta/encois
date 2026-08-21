resource "google_secret_manager_secret" "application" {
  for_each = var.secret_names

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
    if name == "cloud-sql-runtime-url"
  }

  secret_id = google_secret_manager_secret.application[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_temporal_accessor" {
  for_each = {
    for name in var.secret_names : name => name
    if name == var.temporal_secret_name
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

resource "google_secret_manager_secret_iam_member" "runtime_control_plane_accessor" {
  for_each = {
    for name, secret in google_secret_manager_secret.application : name => secret
    if var.enable_agent_runtime && name == var.control_plane_secret_name
  }

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent_runtime.email}"
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
