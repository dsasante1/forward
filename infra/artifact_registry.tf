resource "google_artifact_registry_repository" "server" {
  location      = var.region
  repository_id = var.ar_repo_name
  format        = "DOCKER"
  description   = "Container images for the Forward backend (apps/server)."

  # Every deploy-backend run pushes a new :<git-sha> image; without pruning they
  # accumulate unbounded (storage $/GB-month). Keep the most recent images for
  # rollback headroom, and delete anything older that falls outside that window.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-older-than-30d"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.apis]
}
