resource "google_compute_region_network_endpoint_group" "dashboard" {
  count = local.edge_enabled && var.enable_dashboard ? 1 : 0

  name                  = "${local.name_prefix}-dashboard-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.dashboard[0].name
  }
}

resource "google_compute_region_network_endpoint_group" "api" {
  count = local.edge_enabled && var.enable_api ? 1 : 0

  name                  = "${local.name_prefix}-api-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.api[0].name
  }
}

resource "google_compute_backend_service" "dashboard" {
  count = local.edge_enabled && var.enable_dashboard ? 1 : 0

  name                  = "${local.name_prefix}-dashboard-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  timeout_sec            = 60

  backend {
    group = google_compute_region_network_endpoint_group.dashboard[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_backend_service" "api" {
  count = local.edge_enabled && var.enable_api ? 1 : 0

  name                  = "${local.name_prefix}-api-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  timeout_sec            = 60

  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  count = local.edge_enabled ? 1 : 0

  name            = "${local.name_prefix}-https-routing"
  default_service = google_compute_backend_service.dashboard[0].id

  host_rule {
    hosts        = [var.domain_name]
    path_matcher = "application"
  }

  path_matcher {
    name            = "application"
    default_service = google_compute_backend_service.dashboard[0].id

    path_rule {
      paths   = ["/dashboard", "/dashboard/*"]
      service = google_compute_backend_service.dashboard[0].id
    }

    dynamic "path_rule" {
      for_each = var.enable_api ? [true] : []

      content {
        paths   = ["/api", "/api/*", "/healthz", "/healthz/*"]
        service = google_compute_backend_service.api[0].id
      }
    }
  }

}

resource "google_compute_managed_ssl_certificate" "public" {
  count = local.edge_enabled ? 1 : 0

  name = "${local.name_prefix}-certificate"

  managed {
    domains = [var.domain_name]
  }
}

resource "google_compute_target_https_proxy" "public" {
  count = local.edge_enabled ? 1 : 0

  name             = "${local.name_prefix}-https-proxy"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.public[0].id]
}

resource "google_compute_global_address" "public" {
  count = local.edge_enabled ? 1 : 0

  name = "${local.name_prefix}-public-ip"
}

resource "google_compute_global_forwarding_rule" "https" {
  count = local.edge_enabled ? 1 : 0

  name                  = "${local.name_prefix}-https-forwarding"
  target                = google_compute_target_https_proxy.public[0].id
  ip_address            = google_compute_global_address.public[0].address
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_url_map" "http_redirect" {
  count = local.edge_enabled ? 1 : 0

  name = "${local.name_prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = local.edge_enabled ? 1 : 0

  name    = "${local.name_prefix}-http-proxy"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = local.edge_enabled ? 1 : 0

  name                  = "${local.name_prefix}-http-forwarding"
  target                = google_compute_target_http_proxy.redirect[0].id
  ip_address            = google_compute_global_address.public[0].address
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
