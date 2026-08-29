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
  default     = "US-EAST1"
}

variable "deployer_account_id" {
  description = "Service account ID used by CI or an impersonated local deployer."
  type        = string
  default     = "encois-infra-deployer"
}

variable "github_repository" {
  description = "GitHub repository allowed to impersonate the deployer, in owner/repository form."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use owner/repository format."
  }
}

variable "github_branch" {
  description = "Protected GitHub branch allowed to deploy production."
  type        = string
  default     = "main"
}

variable "github_workload_identity_pool_id" {
  description = "Workload Identity Pool ID used by GitHub Actions."
  type        = string
  default     = "encois-github"
}

variable "github_workload_identity_provider_id" {
  description = "OIDC provider ID inside the GitHub Workload Identity Pool."
  type        = string
  default     = "encois-repository"
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
