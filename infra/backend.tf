terraform {
  backend "gcs" {
    # Supply the bucket created by infra/bootstrap with -backend-config.
    prefix = "encois/demo"
  }
}
