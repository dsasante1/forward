# --- Runtime identity: what the Cloud Run server runs as (least privilege) ---
resource "google_service_account" "run_runtime" {
  account_id   = "forward-run-runtime"
  display_name = "Forward Cloud Run runtime"
}

# --- App deploy identity: GitHub Actions builds images + deploys app code ---
resource "google_service_account" "app_deployer" {
  account_id   = "forward-app-deployer"
  display_name = "Forward app CD (Cloud Run + Hosting deploys)"
}

# --- Infra deploy identity: GitHub Actions runs terraform plan/apply ---
resource "google_service_account" "tf_deployer" {
  account_id   = "forward-tf-deployer"
  display_name = "Forward infra CD (terraform)"
}

# App deployer: push images, deploy Cloud Run revisions, deploy Firebase Hosting.
resource "google_project_iam_member" "app_deployer_roles" {
  for_each = toset([
    "roles/run.developer",
    "roles/artifactregistry.writer",
    "roles/firebasehosting.admin",
    "roles/serviceusage.serviceUsageConsumer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app_deployer.email}"
}

# App deployer must be allowed to deploy Cloud Run *as* the runtime SA.
resource "google_service_account_iam_member" "app_deployer_actas_runtime" {
  service_account_id = google_service_account.run_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.app_deployer.email}"
}

# Infra deployer must also be allowed to set the runtime SA on the Cloud Run
# service it manages (terraform create/update needs actAs on the runtime SA).
resource "google_service_account_iam_member" "tf_deployer_actas_runtime" {
  service_account_id = google_service_account.run_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.tf_deployer.email}"
}

# Infra deployer: project rights to manage everything in this module.
resource "google_project_iam_member" "tf_deployer_roles" {
  for_each = toset(var.tf_deployer_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.tf_deployer.email}"
}
