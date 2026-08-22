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
