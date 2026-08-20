resource "google_sql_database_instance" "control_plane" {
  count = var.enable_cloud_sql ? 1 : 0

  name                = "${local.name_prefix}-postgres"
  database_version    = var.cloud_sql_database_version
  region              = var.region
  deletion_protection = true
  connector_enforcement = "REQUIRED"

  settings {
    tier              = var.cloud_sql_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit    = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
  }
}

resource "google_sql_database" "control_plane" {
  count = var.enable_cloud_sql ? 1 : 0

  name            = var.cloud_sql_database_name
  instance        = google_sql_database_instance.control_plane[0].name
  deletion_policy = "ABANDON"
}
