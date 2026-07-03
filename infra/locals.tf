data "google_project" "this" {
  project_id = var.project_id
}

locals {
  ar_repo_url = "${var.region}-docker.pkg.dev/${var.project_id}/${var.ar_repo_name}"

  # principalSet matching any workflow that runs on the configured GitHub repo.
  # The provider's attribute_condition already restricts tokens to this repo;
  # this scopes which SA those tokens may impersonate.
  github_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"

  # Deterministic Cloud Run URL (SERVICE-PROJECT_NUMBER.REGION.run.app). Used to
  # tell the server its own public URL without a Terraform self-reference cycle
  # (injecting the service resource's own `.uri` into its env is not allowed).
  # Override via var.service_url if this project uses a custom domain.
  service_base_url = var.service_url != "" ? var.service_url : "https://${var.service_name}-${data.google_project.this.number}.${var.region}.run.app"

  # Terraform-computed Cloud Tasks config, injected as plain (non-secret) env on
  # the Cloud Run service so the app can enqueue jobs and verify their OIDC token.
  cloud_tasks_env = {
    GCP_PROJECT_ID          = var.project_id
    CLOUD_TASKS_LOCATION    = var.region
    CLOUD_TASKS_QUEUE       = google_cloud_tasks_queue.email.name
    CLOUD_TASKS_SERVICE_URL = local.service_base_url
    CLOUD_TASKS_INVOKER_SA  = google_service_account.tasks_invoker.email
  }
}
