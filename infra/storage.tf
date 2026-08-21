resource "google_storage_bucket" "artifacts" {
  count = var.artifact_bucket_name == "" ? 0 : 1

  name                        = var.artifact_bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.common_labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age = var.artifact_retention_days
    }
  }
}

resource "google_storage_bucket_iam_member" "gateway_object_creator" {
  count = var.artifact_bucket_name == "" || !var.enable_agent_gateway ? 0 : 1

  bucket = google_storage_bucket.artifacts[0].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_storage_bucket_iam_member" "gateway_object_viewer" {
  count = var.artifact_bucket_name == "" || !var.enable_agent_gateway ? 0 : 1

  bucket = google_storage_bucket.artifacts[0].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_storage_bucket_iam_member" "api_object_admin" {
  count = var.artifact_bucket_name == "" || !var.enable_api ? 0 : 1

  bucket = google_storage_bucket.artifacts[0].name
  # The API writes uploaded revisions and removes the object if the database
  # projection cannot be committed. Cloud Storage has no create+delete role.
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}
