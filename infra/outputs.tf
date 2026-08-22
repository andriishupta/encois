output "artifact_repository" {
  description = "Artifact Registry repository resource name."
  value       = google_artifact_registry_repository.containers.name
}

output "public_ip" {
  description = "Global IP for the future DNS A record."
  value       = local.edge_enabled ? google_compute_global_address.public[0].address : null
}

output "public_url" {
  description = "Public HTTPS URL after DNS and the managed certificate are ready."
  value       = local.edge_enabled ? "https://${var.domain_name}" : null
}

output "service_accounts" {
  description = "Application service accounts; these are not Terraform deployer identities."
  value = {
    dashboard     = google_service_account.dashboard.email
    api           = google_service_account.api.email
    agent_runtime = google_service_account.agent_runtime.email
    agent_gateway = google_service_account.agent_gateway.email
  }
}

output "artifact_bucket" {
  description = "Raw evidence bucket, when enabled."
  value       = var.artifact_bucket_name == "" ? null : google_storage_bucket.artifacts[0].name
}

output "secret_ids" {
  description = "Secret Manager secret IDs. Values are intentionally never output."
  value       = { for key, secret in google_secret_manager_secret.application : key => secret.secret_id }
}

output "spanner_database" {
  description = "Optional Spanner database resource name."
  value       = var.enable_spanner ? google_spanner_database.context[0].name : null
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name for the Cloud Run connector and runtime configuration."
  value       = var.enable_cloud_sql ? google_sql_database_instance.control_plane[0].connection_name : null
}

output "cloud_sql_database" {
  description = "Control-plane database name. Credentials are managed outside Terraform."
  value       = var.enable_cloud_sql ? google_sql_database.control_plane[0].name : null
}

output "migration_job" {
  description = "Protected Cloud Run Job used for forward database migrations."
  value       = var.enable_cloud_sql ? google_cloud_run_v2_job.migrations[0].name : null
}

output "retention_job" {
  description = "Protected Cloud Run Job used for tenant-scoped workflow retention cleanup."
  value       = var.enable_cloud_sql ? google_cloud_run_v2_job.retention[0].name : null
}
