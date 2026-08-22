resource "google_cloud_run_v2_job" "integration_health" {
  count = var.enable_api && var.enable_agent_gateway && length(var.integration_health_organization_ids) > 0 ? 1 : 0

  name     = "${local.name_prefix}-integration-health"
  location = var.region
  labels   = local.common_labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.integration_health.email
      max_retries     = 1
      timeout         = "900s"

      containers {
        name    = "integration-health"
        image   = var.api_image
        command = ["node"]
        args    = ["dist/integration-health-dispatcher.js"]

        env {
          name  = "CONTROL_PLANE_URL"
          value = var.api_service_url
        }

        env {
          name  = "CONTROL_PLANE_AUDIENCE"
          value = var.api_service_url
        }

        env {
          name = "CONTROL_PLANE_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.control_plane_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.api_image != ""
      error_message = "api_image must be set when the integration health dispatcher is enabled."
    }
    precondition {
      condition     = var.api_service_url != ""
      error_message = "api_service_url must be set when the integration health dispatcher is enabled."
    }
    precondition {
      condition     = contains(var.secret_names, var.control_plane_secret_name)
      error_message = "control_plane_secret_name must name one of the secret_names when the integration health dispatcher is enabled."
    }
  }
}

resource "google_cloud_run_v2_job_iam_member" "integration_health_scheduler_invoker" {
  count = var.enable_api && var.enable_agent_gateway && length(var.integration_health_organization_ids) > 0 ? 1 : 0

  name     = google_cloud_run_v2_job.integration_health[0].name
  location = var.region
  role     = google_project_iam_custom_role.operations_job_runner[0].name
  member   = "serviceAccount:${google_service_account.operations_scheduler.email}"
}

resource "google_cloud_scheduler_job" "integration_health" {
  for_each = var.enable_api && var.enable_agent_gateway ? var.integration_health_organization_ids : toset([])

  name             = "${local.name_prefix}-health-${substr(md5(each.key), 0, 8)}"
  project          = var.project_id
  region           = var.region
  schedule         = var.integration_health_schedule
  time_zone        = var.retention_schedule_timezone
  attempt_deadline = "900s"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.integration_health[0].name}:run"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{
          name = "integration-health"
          env = [{
            name  = "INTEGRATION_HEALTH_DISPATCH_ORGANIZATION_ID"
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
