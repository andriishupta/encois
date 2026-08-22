output "state_bucket_name" {
  description = "Use this value as the bucket backend-config during main-stack terraform init."
  value       = google_storage_bucket.terraform_state.name
}

output "infra_deployer_email" {
  description = "Dedicated Terraform deployer service account. Prefer workload identity or impersonation; do not create a key."
  value       = google_service_account.infra_deployer.email
}
