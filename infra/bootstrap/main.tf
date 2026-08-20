resource "google_storage_bucket" "terraform_state" {
  name                        = var.state_bucket_name
  location                    = var.state_bucket_location
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "infra_deployer" {
  account_id   = var.deployer_account_id
  display_name = "Encois Terraform infrastructure deployer"
}

resource "google_project_iam_member" "infra_deployer" {
  for_each = var.deployer_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.infra_deployer.email}"
}

