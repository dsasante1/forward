resource "google_artifact_registry_repository" "server" {
  location      = var.region
  repository_id = var.ar_repo_name
  format        = "DOCKER"
  description   = "Container images for the Forward backend (apps/server)."

  depends_on = [google_project_service.apis]
}
