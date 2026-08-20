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
  count = var.artifact_bucket_name == "" ? 0 : 1

  bucket = google_storage_bucket.artifacts[0].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_storage_bucket_iam_member" "runtime_object_viewer" {
  count = var.artifact_bucket_name == "" ? 0 : 1

  bucket = google_storage_bucket.artifacts[0].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_storage_bucket_iam_member" "api_object_viewer" {
  count = var.artifact_bucket_name == "" ? 0 : 1

  bucket = google_storage_bucket.artifacts[0].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.api.email}"
}

