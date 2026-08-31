resource "google_cloud_run_v2_job" "migrations" {
  count = var.enable_cloud_sql ? 1 : 0

  name     = "${local.name_prefix}-migrations"
  location = var.region
  labels   = local.common_labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.migrations.email
      max_retries     = 1
      timeout         = "1800s"

      containers {
        image = var.migration_image

        env {
          name = "DATABASE_MIGRATION_URL"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.migration_secret_name].secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "DATABASE_MIGRATION_SOCKET_PATH"
          value = "/cloudsql/${google_sql_database_instance.control_plane[0].connection_name}"
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
      condition     = var.migration_image != ""
      error_message = "migration_image must be set when Cloud SQL migrations are enabled."
    }
    precondition {
      condition     = contains(var.secret_names, var.migration_secret_name)
      error_message = "migration_secret_name must name one of the secret_names when Cloud SQL migrations are enabled."
    }
  }
}
