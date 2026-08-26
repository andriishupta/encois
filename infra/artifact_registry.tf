resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "Encois ${var.environment} container images"
  format        = "DOCKER"
  labels        = local.common_labels
  depends_on = [
    google_project_service.required["artifactregistry.googleapis.com"]
  ]

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }
}
