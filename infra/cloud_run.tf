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
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
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
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "CORS_ORIGINS"
        value = var.domain_name == "" ? "" : "https://${var.domain_name}"
      }

      env {
        name  = "HOST"
        value = "0.0.0.0"
      }

      env {
        name  = "PORT"
        value = "8080"
      }

      env {
        name  = "AGENT_GATEWAY_POLICY_VERSION"
        value = "policy-read-only-fixture-v1"
      }

      env {
        name  = "ENCOIS_WORKFLOW_MODE"
        value = "temporal"
      }

      dynamic "env" {
        for_each = var.enable_api ? [true] : []

        content {
          name = "AGENT_GATEWAY_CAPABILITY_SECRET"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.execution_capability_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.artifact_bucket_name == "" ? [] : [true]

        content {
          name  = "SOURCE_ARTIFACT_BUCKET"
          value = var.artifact_bucket_name
        }
      }

      dynamic "env" {
        for_each = var.enable_identity_platform ? [true] : []

        content {
          name  = "IDENTITY_PLATFORM_PROJECT_ID"
          value = var.project_id
        }
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
        for_each = var.enable_api && var.temporal_address != "" ? [true] : []

        content {
          name = "TEMPORAL_API_KEY"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.temporal_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_runtime ? [true] : []

        content {
          name = "CONTROL_PLANE_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.control_plane_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_runtime && var.control_plane_service_user_id != "" ? [true] : []

        content {
          name  = "CONTROL_PLANE_SERVICE_USER_ID"
          value = var.control_plane_service_user_id
        }
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
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
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
    precondition {
      condition     = !var.enable_api || var.temporal_address == "" || contains(var.secret_names, var.temporal_secret_name)
      error_message = "temporal_secret_name must name one of the secret_names when API Temporal Cloud is enabled."
    }
    precondition {
      condition     = !var.enable_api || contains(var.secret_names, var.execution_capability_secret_name)
      error_message = "execution_capability_secret_name must name one of the secret_names when the Gateway API is enabled."
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

      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "true"
      }

      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }

      env {
        name  = "AGENT_MEMORY_MODE"
        value = "gcp"
      }

      env {
        name  = "VERTEX_MEMORY_REASONING_ENGINE"
        value = var.vertex_memory_reasoning_engine
      }

      dynamic "env" {
        for_each = var.temporal_address == "" ? [] : [true]

        content {
          name  = "TEMPORAL_HOST_PORT"
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
          name = "TEMPORAL_API_KEY"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.temporal_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_agent_gateway ? [true] : []

        content {
          name  = "AGENT_GATEWAY_URL"
          value = google_cloud_run_v2_service.agent_gateway[0].uri
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_api ? [true] : []

        content {
          name  = "CONTROL_PLANE_URL"
          value = google_cloud_run_v2_service.api[0].uri
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_api ? [true] : []

        content {
          name  = "CONTROL_PLANE_AUDIENCE"
          value = google_cloud_run_v2_service.api[0].uri
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_api ? [true] : []

        content {
          name = "CONTROL_PLANE_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.control_plane_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_agent_gateway ? [true] : []

        content {
          name  = "AGENT_GATEWAY_AUDIENCE"
          value = google_cloud_run_v2_service.agent_gateway[0].uri
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_agent_gateway ? [true] : []

        content {
          name = "AGENT_GATEWAY_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.agent_gateway_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    precondition {
      condition     = var.agent_runtime_image != ""
      error_message = "agent_runtime_image must be set when enable_agent_runtime is true."
    }
    precondition {
      condition     = !var.enable_agent_runtime || var.temporal_address != ""
      error_message = "temporal_address must be set when the agent runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || contains(var.secret_names, var.temporal_secret_name)
      error_message = "temporal_secret_name must name one of the secret_names when the agent runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || var.enable_agent_gateway
      error_message = "The current Go runtime requires enable_agent_gateway because tool Activities use the private HTTP Gateway."
    }
    precondition {
      condition     = !var.enable_agent_runtime || var.vertex_memory_reasoning_engine != ""
      error_message = "vertex_memory_reasoning_engine must be set when the hosted Agent Runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || contains(var.secret_names, var.agent_gateway_secret_name)
      error_message = "agent_gateway_secret_name must name one of the secret_names when the agent runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || !var.enable_api || contains(var.secret_names, var.control_plane_secret_name)
      error_message = "control_plane_secret_name must name one of the secret_names when the Runtime and API are enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || !var.enable_api || !var.enable_cloud_sql || var.control_plane_service_user_id != ""
      error_message = "control_plane_service_user_id is required when the Runtime calls a Cloud SQL-backed API control plane."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_runtime_invoker" {
  count = var.enable_api && var.enable_agent_runtime ? 1 : 0

  name     = google_cloud_run_v2_service.api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.agent_runtime.email}"
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

      env {
        name  = "AGENT_GATEWAY_DATA_MODE"
        value = "gcp"
      }

      env {
        name  = "GIN_MODE"
        value = "release"
      }

      dynamic "env" {
        for_each = var.enable_agent_gateway ? [true] : []

        content {
          name = "AGENT_GATEWAY_CAPABILITY_SECRET"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.execution_capability_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.artifact_bucket_name == "" ? [] : [true]

        content {
          name  = "GCP_STORAGE_BUCKET"
          value = var.artifact_bucket_name
        }
      }

      dynamic "env" {
        for_each = var.enable_spanner ? [true] : []

        content {
          name  = "SPANNER_DATABASE"
          value = "projects/${var.project_id}/instances/${google_spanner_instance.context[0].name}/databases/${google_spanner_database.context[0].name}"
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_gateway ? [true] : []

        content {
          name = "AGENT_GATEWAY_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.agent_gateway_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    precondition {
      condition     = var.agent_gateway_image != ""
      error_message = "agent_gateway_image must be set when enable_agent_gateway is true."
    }
    precondition {
      condition     = contains(var.secret_names, var.agent_gateway_secret_name)
      error_message = "agent_gateway_secret_name must name one of the secret_names when the Agent Gateway is enabled."
    }
    precondition {
      condition     = contains(var.secret_names, var.execution_capability_secret_name)
      error_message = "execution_capability_secret_name must name one of the secret_names when the Agent Gateway is enabled."
    }
    precondition {
      condition     = var.artifact_bucket_name != ""
      error_message = "artifact_bucket_name must be set when the Agent Gateway is enabled."
    }
    precondition {
      condition     = var.enable_spanner
      error_message = "enable_spanner must be true when the Agent Gateway is enabled."
    }
  }
}
