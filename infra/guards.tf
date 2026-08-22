resource "terraform_data" "edge_requirements" {
  count = var.enable_edge ? 1 : 0

  lifecycle {
    precondition {
      condition     = local.edge_enabled
      error_message = "enable_edge requires enable_dashboard=true, enable_api=true, and a non-empty domain_name."
    }
  }
}

resource "terraform_data" "application_requirements" {
  count = var.enable_dashboard || var.enable_api || var.enable_agent_runtime || var.enable_agent_gateway ? 1 : 0

  lifecycle {
    precondition {
      condition     = !var.enable_api || var.enable_identity_platform
      error_message = "enable_api requires enable_identity_platform for the production Google-only authentication path."
    }
    precondition {
      condition     = !var.enable_api || var.temporal_address != ""
      error_message = "enable_api requires temporal_address because the API always runs in Temporal workflow mode."
    }
    precondition {
      condition     = !var.enable_api || var.temporal_namespace != ""
      error_message = "enable_api requires temporal_namespace for the hosted Temporal Cloud namespace."
    }
    precondition {
      condition     = !var.enable_api || var.environment != "production" || var.enable_cloud_sql
      error_message = "A production API requires enable_cloud_sql because the control plane cannot run without its runtime database."
    }
    precondition {
      condition     = !var.enable_cloud_sql || var.migration_image != ""
      error_message = "enable_cloud_sql requires migration_image so schema changes run through the protected Cloud Run migration job."
    }
    precondition {
      condition     = !var.enable_cloud_sql || var.retention_image != ""
      error_message = "enable_cloud_sql requires retention_image so expired workflow data is removed by a protected cleanup job."
    }
    precondition {
      condition     = !var.enable_cloud_sql || contains(var.secret_names, var.retention_secret_name)
      error_message = "retention_secret_name must name one of the secret_names when Cloud SQL is enabled."
    }
    precondition {
      condition     = var.environment != "production" || length(var.retention_organization_ids) > 0
      error_message = "Production requires an explicit retention cleanup schedule target for every organization."
    }
    precondition {
      condition     = var.environment != "production" || !var.enable_api || !var.enable_agent_gateway || length(var.integration_health_organization_ids) > 0
      error_message = "Production requires an explicit integration health schedule target for every organization when the API and Agent Gateway are enabled."
    }
    precondition {
      condition     = !var.enable_api || var.environment != "production" || var.enable_agent_gateway
      error_message = "A production API requires enable_agent_gateway for provider, graph, and tool execution boundaries."
    }
    precondition {
      condition     = !var.enable_api || var.environment != "production" || var.enable_agent_runtime
      error_message = "A production API requires enable_agent_runtime for durable agent execution and Memory inspection."
    }
    precondition {
      condition     = !var.enable_api || var.environment != "production" || var.artifact_bucket_name != ""
      error_message = "A production API requires artifact_bucket_name for source revisions and evidence artifacts."
    }
    precondition {
      condition     = !var.enable_api || var.environment != "production" || var.enable_spanner
      error_message = "A production API requires enable_spanner for the Context Graph admin surface."
    }
    precondition {
      condition     = !var.enable_agent_runtime || var.temporal_namespace != ""
      error_message = "enable_agent_runtime requires temporal_namespace for the hosted Temporal Cloud namespace."
    }
    precondition {
      condition     = !(var.enable_dashboard && var.enable_api) || var.enable_edge
      error_message = "enable_dashboard and enable_api together require enable_edge for /dashboard and /api path routing."
    }
    precondition {
      condition     = !var.enable_identity_platform || var.domain_name != "" || length(var.identity_authorized_domains) > 0
      error_message = "Identity Platform requires domain_name or at least one identity_authorized_domains entry."
    }
  }
}
