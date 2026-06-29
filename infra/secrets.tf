# Secret *containers* only. Values are added out-of-band (`gcloud secrets versions
# add`) so credentials never land in tfstate or tfvars. Terraform owns the
# container + IAM; you own the value.
resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(var.secret_env_names)
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# Let the Cloud Run runtime SA read each secret.
resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each  = google_secret_manager_secret.secrets
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run_runtime.email}"
}
