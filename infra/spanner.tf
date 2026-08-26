resource "google_spanner_instance" "context" {
  count = var.enable_spanner ? 1 : 0

  name             = local.spanner_instance_id
  config           = var.spanner_config
  display_name     = "Encois ${var.environment} context"
  processing_units = var.spanner_processing_units
  labels           = local.common_labels
}

resource "google_spanner_database" "context" {
  count = var.enable_spanner ? 1 : 0

  instance = local.spanner_instance_id
  name     = var.spanner_database_name
  ddl      = [file("${path.module}/spanner-schema.sql")]
}
