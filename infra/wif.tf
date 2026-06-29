# Workload Identity Federation: lets GitHub Actions authenticate to GCP via OIDC,
# so no service-account JSON keys are ever stored in GitHub.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions"
  description               = "OIDC federation for GitHub Actions deploys."

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens issued for our repo may use this provider.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Allow the repo's workflows to impersonate each deployer SA.
resource "google_service_account_iam_member" "app_deployer_wif" {
  service_account_id = google_service_account.app_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_principal
}

resource "google_service_account_iam_member" "tf_deployer_wif" {
  service_account_id = google_service_account.tf_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_principal
}
