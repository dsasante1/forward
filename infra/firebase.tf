resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.apis]
}

resource "google_firebase_hosting_site" "dashboard" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.hosting_site_id

  depends_on = [google_firebase_project.default]
}

# Internal Platform Admin SPA (apps/admin) — its own Hosting site, deployed by
# .github/workflows/deploy-admin.yml, separate from the customer dashboard.
resource "google_firebase_hosting_site" "admin" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.admin_hosting_site_id

  depends_on = [google_firebase_project.default]
}
