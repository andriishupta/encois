resource "google_cloud_run_v2_job" "retention" {
  count = var.enable_cloud_sql ? 1 : 0

  name     = "${local.name_prefix}-retention"
  location = var.region
  labels   = local.common_labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.retention.email
      max_retries     = 1
      timeout         = "1800s"

      containers {
        name    = "retention-cleanup"
        image   = var.retention_image
        command = ["pnpm"]
        args    = ["--filter", "@encois/persistence", "retention:cleanup"]

        env {
          name = "DATABASE_RETENTION_URL"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.retention_secret_name].secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "RETENTION_CLEANUP_BATCH_SIZE"
          value = tostring(var.retention_cleanup_batch_size)
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"

        cloud_sql_instance {
          instances = [google_sql_database_instance.control_plane[0].connection_name]
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.retention_image != ""
      error_message = "retention_image must be set when Cloud SQL retention cleanup is enabled."
    }
    precondition {
      condition     = contains(var.secret_names, var.retention_secret_name)
      error_message = "retention_secret_name must name one of the secret_names when retention cleanup is enabled."
    }
  }
}

resource "google_cloud_run_v2_job_iam_member" "retention_scheduler_invoker" {
  count = var.enable_cloud_sql && length(var.retention_organization_ids) > 0 ? 1 : 0

  name     = google_cloud_run_v2_job.retention[0].name
  location = var.region
  role     = google_project_iam_custom_role.operations_job_runner[0].name
  member   = "serviceAccount:${google_service_account.operations_scheduler.email}"
}

resource "google_cloud_scheduler_job" "retention" {
  for_each = var.enable_cloud_sql ? var.retention_organization_ids : toset([])

  name             = "${local.name_prefix}-retention-${substr(md5(each.key), 0, 8)}"
  project          = var.project_id
  region           = var.region
  schedule         = var.retention_schedule
  time_zone        = var.retention_schedule_timezone
  attempt_deadline = "1800s"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.retention[0].name}:run"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{
          name = "retention-cleanup"
          env = [{
            name  = "RETENTION_ORGANIZATION_ID"
            value = each.key
          }]
        }]
      }
    }))

    oauth_token {
      service_account_email = google_service_account.operations_scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
}
