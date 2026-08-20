resource "google_identity_platform_config" "default" {
  count = var.enable_identity_platform ? 1 : 0

  project            = var.project_id
  deletion_policy    = "PREVENT"
  authorized_domains = local.authorized_domains

  sign_in {
    email {
      enabled           = true
      password_required = true
    }
  }
}

