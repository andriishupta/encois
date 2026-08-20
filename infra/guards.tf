resource "terraform_data" "edge_requirements" {
  count = var.enable_edge ? 1 : 0

  lifecycle {
    precondition {
      condition     = local.edge_enabled
      error_message = "enable_edge requires enable_dashboard=true, enable_api=true, and a non-empty domain_name."
    }
  }
}

