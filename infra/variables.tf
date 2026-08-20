variable "project_id" {
  description = "Existing GCP project ID. Project creation is intentionally outside this stack."
  type        = string
}

variable "region" {
  description = "Primary region for Cloud Run, regional NEGs, storage, and optional Spanner."
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment name used in resource names and labels."
  type        = string
  default     = "demo"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,15}$", var.environment))
    error_message = "environment must start with a lowercase letter and contain only lowercase letters, digits, and hyphens."
  }
}

variable "name_prefix" {
  description = "Short product prefix used in resource names."
  type        = string
  default     = "encois"
}

variable "domain_name" {
  description = "Future public hostname, for example encois.com. Required only when enable_edge is true."
  type        = string
  default     = ""
}

variable "identity_authorized_domains" {
  description = "Additional Identity Platform OAuth redirect domains."
  type        = list(string)
  default     = []
}

variable "enable_identity_platform" {
  description = "Create the project-level Identity Platform configuration. Requires billing and the Identity Toolkit API."
  type        = bool
  default     = false
}

variable "enable_cloud_sql" {
  description = "Create the optional Cloud SQL PostgreSQL control-plane database. It is billable and disabled by default."
  type        = bool
  default     = false
}

variable "cloud_sql_database_version" {
  description = "Cloud SQL PostgreSQL major version."
  type        = string
  default     = "POSTGRES_16"
}

variable "cloud_sql_tier" {
  description = "Starting Cloud SQL machine tier. Use a larger HA tier for production after load testing."
  type        = string
  default     = "db-f1-micro"
}

variable "cloud_sql_database_name" {
  description = "Control-plane database name used by Drizzle."
  type        = string
  default     = "encois"
}

variable "enable_dashboard" {
  description = "Create the dashboard Cloud Run service."
  type        = bool
  default     = false
}

variable "dashboard_image" {
  description = "Immutable Artifact Registry image for the dashboard container."
  type        = string
  default     = ""
}

variable "dashboard_min_instances" {
  description = "Minimum dashboard Cloud Run instances. Set to 0 for a lower-cost demo."
  type        = number
  default     = 1
}

variable "dashboard_max_instances" {
  description = "Maximum dashboard Cloud Run instances."
  type        = number
  default     = 2
}

variable "enable_api" {
  description = "Create the public Gateway API Cloud Run service."
  type        = bool
  default     = false
}

variable "api_image" {
  description = "Immutable Artifact Registry image for the Gateway API container."
  type        = string
  default     = ""
}

variable "api_min_instances" {
  description = "Minimum Gateway API Cloud Run instances."
  type        = number
  default     = 1
}

variable "api_max_instances" {
  description = "Maximum Gateway API Cloud Run instances."
  type        = number
  default     = 2
}

variable "enable_agent_runtime" {
  description = "Create the private Go Temporal/ADK worker Cloud Run service."
  type        = bool
  default     = false
}

variable "temporal_address" {
  description = "Temporal Cloud endpoint, for example namespace.tmprl.cloud:7233."
  type        = string
  default     = ""
}

variable "temporal_namespace" {
  description = "Temporal Cloud namespace used by the worker."
  type        = string
  default     = ""
}

variable "temporal_secret_name" {
  description = "Secret container containing the Temporal client credential material."
  type        = string
  default     = "temporal-client-credentials"
}

variable "agent_runtime_image" {
  description = "Immutable Artifact Registry image for the Go agent runtime."
  type        = string
  default     = ""
}

variable "agent_runtime_min_instances" {
  description = "Minimum worker instances. Keep at least 1 while polling Temporal."
  type        = number
  default     = 1
}

variable "agent_runtime_max_instances" {
  description = "Maximum worker instances."
  type        = number
  default     = 2
}

variable "enable_agent_gateway" {
  description = "Create the private Agent Gateway Cloud Run service."
  type        = bool
  default     = false
}

variable "agent_gateway_image" {
  description = "Immutable Artifact Registry image for the private Agent Gateway container."
  type        = string
  default     = ""
}

variable "agent_gateway_min_instances" {
  description = "Minimum private Agent Gateway instances."
  type        = number
  default     = 1
}

variable "agent_gateway_max_instances" {
  description = "Maximum private Agent Gateway instances."
  type        = number
  default     = 2
}

variable "enable_edge" {
  description = "Create the global HTTPS Application Load Balancer and path routing."
  type        = bool
  default     = false
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository ID for container images."
  type        = string
  default     = "containers"
}

variable "artifact_bucket_name" {
  description = "Globally unique bucket name for raw evidence and large investigation artifacts. Empty disables the bucket."
  type        = string
  default     = ""
}

variable "artifact_retention_days" {
  description = "Lifecycle retention for raw artifacts."
  type        = number
  default     = 30
}

variable "secret_names" {
  description = "Secret containers to create. Terraform never stores secret values."
  type        = set(string)
  default     = ["cloud-sql-runtime-url", "temporal-client-credentials"]
}

variable "enable_spanner" {
  description = "Optional Spanner foundation for normalized company context. Disabled by default because it is a billable resource."
  type        = bool
  default     = false
}

variable "spanner_config" {
  description = "Spanner instance configuration, for example regional-europe-west1."
  type        = string
  default     = "regional-europe-west1"
}

variable "spanner_processing_units" {
  description = "Small starting Spanner capacity. Review cost and Graph availability before enabling."
  type        = number
  default     = 100
}

variable "spanner_database_name" {
  description = "Spanner database name for normalized context."
  type        = string
  default     = "context"
}
