resource "google_cloud_run_v2_service" "dashboard" {
  count = var.enable_dashboard ? 1 : 0

  name                = "${local.name_prefix}-dashboard"
  location            = var.region
  ingress             = local.edge_enabled ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
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

      startup_probe {
        failure_threshold = 6
        period_seconds    = 10
        timeout_seconds   = 3

        http_get {
          path = "/health/ready"
        }
      }

      liveness_probe {
        failure_threshold = 3
        period_seconds    = 30
        timeout_seconds   = 3

        http_get {
          path = "/health/live"
        }
      }

      env {
        name  = "PUBLIC_BASE_PATH"
        value = local.edge_enabled ? "/dashboard" : "/"
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
  ingress             = local.edge_enabled ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
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
        cpu_idle = false

        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        failure_threshold = 12
        period_seconds    = 10
        timeout_seconds   = 5

        http_get {
          path = "/health/ready"
        }
      }

      liveness_probe {
        failure_threshold = 3
        period_seconds    = 30
        timeout_seconds   = 5

        http_get {
          path = "/health/live"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "CORS_ORIGINS"
        value = local.edge_enabled ? "https://${var.domain_name}" : local.dashboard_service_url
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
        value = var.agent_gateway_policy_version
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
        for_each = var.enable_api && var.enable_agent_gateway ? [true] : []

        content {
          name  = "AGENT_GATEWAY_URL"
          value = local.agent_gateway_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_gateway ? [true] : []

        content {
          name  = "AGENT_GATEWAY_SERVICE_ACCOUNT_EMAIL"
          value = google_service_account.agent_gateway.email
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_gateway ? [true] : []

        content {
          name  = "AGENT_GATEWAY_AUDIENCE"
          value = local.agent_gateway_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_gateway ? [true] : []

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
        for_each = var.enable_api ? [true] : []

        content {
          name  = "ENCOIS_INTEGRATION_OAUTH_CALLBACK_URL"
          value = "${local.api_public_url}/api/v1/integrations/authorization/callback"
        }
      }

      dynamic "env" {
        for_each = var.enable_api ? [true] : []

        content {
          name  = "ENCOIS_PUBLIC_BASE_URL"
          value = local.api_public_url
        }
      }

      dynamic "env" {
        for_each = var.enable_api ? [true] : []

        content {
          name  = "ENCOIS_INTEGRATION_OAUTH_SUCCESS_URL"
          value = "${local.dashboard_application_url}/integrations/{integrationId}?authorization=complete"
        }
      }

      dynamic "env" {
        for_each = var.enable_api ? [true] : []

        content {
          name = "ENCOIS_INTEGRATION_OAUTH_CONFIG_JSON"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.integration_oauth_config_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_api ? [true] : []

        content {
          name = "ENCOIS_INTEGRATION_OAUTH_STATE_SECRET"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.integration_oauth_state_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_identity_platform ? [true] : []

        content {
          name  = "IDENTITY_PLATFORM_ALLOWED_SIGN_IN_PROVIDERS"
          value = "google.com"
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
        for_each = var.enable_api && var.enable_agent_runtime ? [true] : []

        content {
          name  = "AGENT_RUNTIME_URL"
          value = local.agent_runtime_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_runtime ? [true] : []

        content {
          name  = "AGENT_RUNTIME_AUDIENCE"
          value = local.agent_runtime_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_api && var.enable_agent_runtime ? [true] : []

        content {
          name = "AGENT_RUNTIME_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.agent_runtime_secret_name].secret_id
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
      condition     = var.agent_gateway_policy_version != ""
      error_message = "agent_gateway_policy_version must be set when enable_api is true."
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
    precondition {
      condition     = !var.enable_api || !var.enable_agent_gateway || contains(var.secret_names, var.agent_gateway_secret_name)
      error_message = "agent_gateway_secret_name must name one of the secret_names when the API calls the Agent Gateway."
    }
    precondition {
      condition     = !var.enable_api || !var.enable_agent_runtime || contains(var.secret_names, var.agent_runtime_secret_name)
      error_message = "agent_runtime_secret_name must name one of the secret_names when the API calls the Agent Runtime."
    }
    precondition {
      condition     = !var.enable_api || !var.enable_agent_gateway || local.agent_gateway_service_url != ""
      error_message = "agent_gateway_service_url must be set when the API calls the Agent Gateway."
    }
    precondition {
      condition     = !var.enable_api || !var.enable_agent_runtime || local.agent_runtime_service_url != ""
      error_message = "agent_runtime_service_url must be set when the API calls the Agent Runtime."
    }
    precondition {
      condition     = !var.enable_api || contains(var.secret_names, var.integration_oauth_config_secret_name)
      error_message = "integration_oauth_config_secret_name must name one of the secret_names when the Gateway API is enabled."
    }
    precondition {
      condition     = !var.enable_api || contains(var.secret_names, var.integration_oauth_state_secret_name)
      error_message = "integration_oauth_state_secret_name must name one of the secret_names when the Gateway API is enabled."
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

resource "google_cloud_run_v2_service_iam_member" "integration_health_job_invoker" {
  count = var.enable_api && var.enable_agent_gateway && length(var.integration_health_organization_ids) > 0 ? 1 : 0

  name     = google_cloud_run_v2_service.api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.integration_health.email}"
}

resource "google_cloud_run_v2_service" "agent_runtime" {
  count = var.enable_agent_runtime ? 1 : 0

  name                = "${local.name_prefix}-runtime"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
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
        cpu_idle = false

        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      startup_probe {
        failure_threshold = 12
        period_seconds    = 10
        timeout_seconds   = 5

        http_get {
          path = "/health/ready"
        }
      }

      liveness_probe {
        failure_threshold = 3
        period_seconds    = 30
        timeout_seconds   = 5

        http_get {
          path = "/health/live"
        }
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.google_cloud_location
      }

      env {
        name  = "GOOGLE_GENAI_USE_AGENT_PLATFORM"
        value = "true"
      }

      env {
        name  = "GOOGLE_CLOUD_MODEL_LOCATION"
        value = var.google_cloud_model_location
      }

      env {
        name  = "AGENT_MEMORY_MODE"
        value = "gcp"
      }

      env {
        name  = "AGENT_PLATFORM_MEMORY_REASONING_ENGINE"
        value = var.agent_platform_memory_reasoning_engine
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
          value = local.agent_gateway_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime ? [true] : []

        content {
          name = "AGENT_RUNTIME_SERVICE_TOKEN"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.agent_runtime_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_api ? [true] : []

        content {
          name  = "CONTROL_PLANE_URL"
          value = local.api_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_runtime && var.enable_api ? [true] : []

        content {
          name  = "CONTROL_PLANE_AUDIENCE"
          value = local.api_service_url
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
          value = local.agent_gateway_service_url
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
      condition     = !var.enable_agent_runtime || var.agent_platform_memory_reasoning_engine != ""
      error_message = "agent_platform_memory_reasoning_engine must be set when the hosted Agent Runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || contains(var.secret_names, var.agent_gateway_secret_name)
      error_message = "agent_gateway_secret_name must name one of the secret_names when the agent runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || contains(var.secret_names, var.agent_runtime_secret_name)
      error_message = "agent_runtime_secret_name must name one of the secret_names when the agent runtime is enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || !var.enable_api || contains(var.secret_names, var.control_plane_secret_name)
      error_message = "control_plane_secret_name must name one of the secret_names when the Runtime and API are enabled."
    }
    precondition {
      condition     = !var.enable_agent_runtime || !var.enable_api || !var.enable_cloud_sql || var.control_plane_service_user_id != ""
      error_message = "control_plane_service_user_id is required when the Runtime calls a Cloud SQL-backed API control plane."
    }
    precondition {
      condition     = !var.enable_agent_runtime || !var.enable_agent_gateway || local.agent_gateway_service_url != ""
      error_message = "agent_gateway_service_url must be set when the Runtime calls the Agent Gateway."
    }
    precondition {
      condition     = !var.enable_agent_runtime || !var.enable_api || local.api_service_url != ""
      error_message = "api_service_url must be set when the Runtime calls the Gateway API."
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

resource "google_cloud_run_v2_service_iam_member" "agent_gateway_api_invoker" {
  count = var.enable_api && var.enable_agent_gateway ? 1 : 0

  name     = google_cloud_run_v2_service.agent_gateway[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service_iam_member" "agent_runtime_api_invoker" {
  count = var.enable_api && var.enable_agent_runtime ? 1 : 0

  name     = google_cloud_run_v2_service.agent_runtime[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service_iam_member" "api_agent_gateway_invoker" {
  count = var.enable_api && var.enable_agent_gateway ? 1 : 0

  name     = google_cloud_run_v2_service.api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.agent_gateway.email}"
}

resource "google_cloud_run_v2_service" "agent_gateway" {
  count = var.enable_agent_gateway ? 1 : 0

  name                = "${local.name_prefix}-gateway"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
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

      startup_probe {
        failure_threshold = 6
        period_seconds    = 10
        timeout_seconds   = 3

        http_get {
          path = "/health/ready"
        }
      }

      liveness_probe {
        failure_threshold = 3
        period_seconds    = 30
        timeout_seconds   = 3

        http_get {
          path = "/health/live"
        }
      }

      env {
        name  = "AGENT_GATEWAY_DATA_MODE"
        value = "gcp"
      }

      env {
        name  = "AGENT_GATEWAY_STORAGE_MODE"
        value = "gcs"
      }

      env {
        name  = "AGENT_GATEWAY_POLICY_VERSION"
        value = var.agent_gateway_policy_version
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
        for_each = local.spanner_enabled ? [true] : []

        content {
          name  = "SPANNER_DATABASE"
          value = local.spanner_database_resource
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

      dynamic "env" {
        for_each = var.enable_agent_gateway && var.enable_api ? [true] : []

        content {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_gateway && var.enable_api ? [true] : []

        content {
          name = "INTEGRATION_OAUTH_CONFIG_JSON"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application[var.integration_oauth_config_secret_name].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_gateway && var.enable_api ? [true] : []

        content {
          name  = "CONTROL_PLANE_URL"
          value = local.api_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_gateway && var.enable_api ? [true] : []

        content {
          name  = "CONTROL_PLANE_AUDIENCE"
          value = local.api_service_url
        }
      }

      dynamic "env" {
        for_each = var.enable_agent_gateway && var.enable_api ? [true] : []

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
      condition     = var.agent_gateway_policy_version != ""
      error_message = "agent_gateway_policy_version must be set when enable_agent_gateway is true."
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
      condition     = local.spanner_enabled
      error_message = "A managed or existing Spanner instance must be configured when the Agent Gateway is enabled."
    }
    precondition {
      condition     = var.enable_api
      error_message = "enable_api must be true when the hosted Agent Gateway resolves provider credentials."
    }
    precondition {
      condition     = contains(var.secret_names, var.control_plane_secret_name)
      error_message = "control_plane_secret_name must name one of the secret_names when the hosted Agent Gateway is enabled."
    }
    precondition {
      condition     = !var.enable_api || local.api_service_url != ""
      error_message = "api_service_url must be set when the Agent Gateway calls the Gateway API."
    }
  }
}
