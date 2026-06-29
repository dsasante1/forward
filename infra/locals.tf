locals {
  ar_repo_url = "${var.region}-docker.pkg.dev/${var.project_id}/${var.ar_repo_name}"

  # principalSet matching any workflow that runs on the configured GitHub repo.
  # The provider's attribute_condition already restricts tokens to this repo;
  # this scopes which SA those tokens may impersonate.
  github_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
