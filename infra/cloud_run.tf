resource "google_cloud_run_v2_service" "dashboard" {
  count = var.enable_dashboard ? 1 : 0

  name                = "${local.name_prefix}-dashboard"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = true
  labels              = local.common_labels

  template {
    service_account                  = google_service_account.dashboard.email
    max_instance_request_concurrency = 80
    timeout                          = "60s"

    scaling {
      min_instance_count = var.dashboard_min_instances
      max_instance_count = var.dashboard_max_instances
    }

    containers {
      image = var.dashboard_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "PUBLIC_BASE_PATH"
        value = "/dashboard"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION"
    percent = 100
    latest_revision = true
  }

  lifecycle {
    precondition {
      condition     = var.dashboard_image != ""
      error_message = "dashboard_image must be set when enable_dashboard is true."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "dashboard_invoker" {
  count = var.enable_dashboard ? 1 : 0

  name     = google_cloud_run_v2_service.dashboard[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "api" {
  count = var.enable_api ? 1 : 0

  name                = "${local.name_prefix}-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = true
  labels              = local.common_labels

  template {
    service_account                  = google_service_account.api.email
    max_instance_request_concurrency = 80
    timeout                          = "60s"

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    containers {
      image = var.api_image

      dynamic "volume_mounts" {
        for_each = var.enable_cloud_sql ? [true] : []

        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "CORS_ORIGINS"
        value = var.domain_name == "" ? "" : "https://${var.domain_name}"
      }

      dynamic "env" {
        for_each = var.enable_cloud_sql ? [true] : []

        content {
          name = "DATABASE_RUNTIME_URL"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application["cloud-sql-runtime-url"].secret_id
              version = "latest"
            }
          }
        }
      }
    }

    dynamic "volumes" {
      for_each = var.enable_cloud_sql ? [true] : []

      content {
        name = "cloudsql"

        cloud_sql_instance {
          instances = [google_sql_database_instance.control_plane[0].connection_name]
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION"
    percent = 100
    latest_revision = true
  }

  lifecycle {
    precondition {
      condition     = var.api_image != ""
      error_message = "api_image must be set when enable_api is true."
    }
    precondition {
      condition     = !var.enable_cloud_sql || contains(var.secret_names, "cloud-sql-runtime-url")
      error_message = "cloud-sql-runtime-url must be included in secret_names when enable_cloud_sql is true."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_invoker" {
  count = var.enable_api ? 1 : 0

  name     = google_cloud_run_v2_service.api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "agent_runtime" {
  count = var.enable_agent_runtime ? 1 : 0

  name                = "${local.name_prefix}-runtime"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = true
  labels              = local.common_labels

  template {
    service_account                  = google_service_account.agent_runtime.email
    max_instance_request_concurrency = 1
    timeout                          = "3600s"

    scaling {
      min_instance_count = var.agent_runtime_min_instances
      max_instance_count = var.agent_runtime_max_instances
    }

    containers {
      image = var.agent_runtime_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      dynamic "env" {
        for_each = var.temporal_address == "" ? [] : [true]

        content {
          name  = "TEMPORAL_ADDRESS"
          value = var.temporal_address
        }
      }

      dynamic "env" {
        for_each = var.temporal_namespace == "" ? [] : [true]

        content {
          name  = "TEMPORAL_NAMESPACE"
          value = var.temporal_namespace
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime ? [true] : []

        content {
          name = "TEMPORAL_CLIENT_CREDENTIALS"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.temporal_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION"
    percent = 100
    latest_revision = true
  }

  lifecycle {
    precondition {
      condition     = var.agent_runtime_image != ""
      error_message = "agent_runtime_image must be set when enable_agent_runtime is true."
    }
    precondition {
      condition     = contains(var.secret_names, var.temporal_secret_name)
      error_message = "temporal_secret_name must name one of the secret_names when the agent runtime is enabled."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "agent_gateway_invoker" {
  count = var.enable_agent_runtime && var.enable_agent_gateway ? 1 : 0

  name     = google_cloud_run_v2_service.agent_gateway[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_cloud_run_v2_service" "agent_gateway" {
  count = var.enable_agent_gateway ? 1 : 0

  name                = "${local.name_prefix}-gateway"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = true
  labels              = local.common_labels

  template {
    service_account                  = google_service_account.agent_gateway.email
    max_instance_request_concurrency = 20
    timeout                          = "120s"

    scaling {
      min_instance_count = var.agent_gateway_min_instances
      max_instance_count = var.agent_gateway_max_instances
    }

    containers {
      image = var.agent_gateway_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION"
    percent = 100
    latest_revision = true
  }

  lifecycle {
    precondition {
      condition     = var.agent_gateway_image != ""
      error_message = "agent_gateway_image must be set when enable_agent_gateway is true."
    }
  }
}
