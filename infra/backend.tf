# Remote state lives in a versioned, encrypted GCS bucket. A backend block cannot
# interpolate variables, so the bucket is supplied at init time:
#
#   terraform init -backend-config="bucket=<your-tfstate-bucket>"
#
# The bucket must exist BEFORE the first `terraform init` — Terraform cannot create
# its own state backend. Create it once during bootstrap (see infra/README.md).
terraform {
  backend "gcs" {
    # bucket is provided via -backend-config at init time.
    prefix = "forward/prod"
  }
}
