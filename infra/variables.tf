variable "project_id" {
  description = "GCP project id that hosts Cloud Run, Artifact Registry, and Firebase Hosting."
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run + Artifact Registry."
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "owner/repo allowed to impersonate the deployer SAs via Workload Identity Federation."
  type        = string
  default     = "dsasante1/forward"
}

variable "service_name" {
  description = "Cloud Run service name (also the image name in Artifact Registry)."
  type        = string
  default     = "forward-server"
}

variable "ar_repo_name" {
  description = "Artifact Registry Docker repository id."
  type        = string
  default     = "forward"
}

variable "hosting_site_id" {
  description = "Firebase Hosting site id for the dashboard SPA."
  type        = string
  default     = "forward-dashboard"
}

variable "secret_env_names" {
  description = "Secret Manager secrets injected into Cloud Run as env vars (same name). Values are added out-of-band — never by Terraform."
  type        = list(string)
  default = [
    "DATABASE_URL",
    "DIRECT_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CLERK_SECRET_KEY",
    "MAILTRAP_API_KEY",
  ]
}

variable "plain_env" {
  description = "Non-secret env vars passed to Cloud Run as plain values (e.g. SUPABASE_URL, CORS_ORIGINS, APP_BASE_URL)."
  type        = map(string)
  default     = {}
}

variable "max_instances" {
  description = "Cloud Run max instances (min is fixed at 0 = scale to zero)."
  type        = number
  default     = 4
}

variable "tf_deployer_roles" {
  description = "Project roles for the infra (terraform) deployer SA. Broad by necessity; tighten to taste."
  type        = list(string)
  default = [
    "roles/run.admin",
    "roles/artifactregistry.admin",
    "roles/secretmanager.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/firebase.admin",
  ]
}
