resource "google_identity_platform_config" "default" {
  count = var.enable_identity_platform ? 1 : 0

  project            = var.project_id
  authorized_domains = local.authorized_domains

  lifecycle {
    prevent_destroy = true
  }

  sign_in {
    email {
      enabled           = false
      password_required = false
    }
  }
}

resource "google_identity_platform_default_supported_idp_config" "google" {
  count = var.enable_identity_platform ? 1 : 0

  project         = var.project_id
  idp_id          = "google.com"
  enabled         = true
  client_id       = var.google_oauth_client_id
  client_secret   = var.google_oauth_client_secret
  deletion_policy = "PREVENT"

  lifecycle {
    precondition {
      condition     = var.google_oauth_client_id != ""
      error_message = "google_oauth_client_id must be set when Identity Platform is enabled."
    }
    precondition {
      condition     = var.google_oauth_client_secret != ""
      error_message = "google_oauth_client_secret must be provided when Identity Platform is enabled."
    }
  }

  depends_on = [google_identity_platform_config.default]
}
