output "cloud_run_url" {
  description = "Public URL of the backend — use as VITE_API_BASE_URL for the dashboard build."
  value       = google_cloud_run_v2_service.server.uri
}

output "artifact_registry_repo" {
  description = "Docker repo path for the server image (region-docker.pkg.dev/project/repo)."
  value       = local.ar_repo_url
}

output "hosting_site_id" {
  description = "Firebase Hosting site id."
  value       = google_firebase_hosting_site.dashboard.site_id
}

output "wif_provider" {
  description = "Full WIF provider resource name — set as the GCP_WIF_PROVIDER repo variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "app_deployer_sa" {
  description = "App CD service account email — set as GCP_APP_DEPLOYER_SA repo variable."
  value       = google_service_account.app_deployer.email
}

output "tf_deployer_sa" {
  description = "Infra CD service account email — set as GCP_TF_DEPLOYER_SA repo variable."
  value       = google_service_account.tf_deployer.email
}

output "runtime_sa" {
  description = "Cloud Run runtime service account email."
  value       = google_service_account.run_runtime.email
}
