output "state_bucket_name" {
  description = "Use this value as the bucket backend-config during main-stack terraform init."
  value       = google_storage_bucket.terraform_state.name
}

output "infra_deployer_email" {
  description = "Dedicated Terraform deployer service account. Prefer workload identity or impersonation; do not create a key."
  value       = google_service_account.infra_deployer.email
}

output "github_workload_identity_provider" {
  description = "Set this value as the production GCP_WIF_PROVIDER GitHub secret."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_service_account" {
  description = "Set this value as the production GCP_DEPLOYER_SERVICE_ACCOUNT GitHub secret."
  value       = google_service_account.infra_deployer.email
}
