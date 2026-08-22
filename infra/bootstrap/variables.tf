variable "project_id" {
  description = "Existing GCP project ID. Create the project and attach billing outside Terraform first."
  type        = string
}

variable "state_bucket_name" {
  description = "Globally unique bucket name for the Terraform remote state."
  type        = string
}

variable "state_bucket_location" {
  description = "Location for the Terraform state bucket."
  type        = string
  default     = "EU"
}

variable "deployer_account_id" {
  description = "Service account ID used by CI or an impersonated local deployer."
  type        = string
  default     = "encois-infra-deployer"
}

variable "deployer_roles" {
  description = "Project roles for the dedicated infrastructure deployer. Review and reduce this list as the stack stabilizes."
  type        = set(string)
  default = [
    "roles/artifactregistry.admin",
    "roles/cloudsql.admin",
    "roles/compute.loadBalancerAdmin",
    "roles/compute.securityAdmin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.serviceAccountUser",
    "roles/identityplatform.admin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/run.admin",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/spanner.admin",
    "roles/storage.admin",
  ]
}
