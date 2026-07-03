# --- Cloud Tasks: async job queue that delivers work back to the server ---
# The server enqueues background jobs (e.g. sending email) onto this queue; the
# queue POSTs each task to POST /internal/jobs/* on the Cloud Run service. This
# keeps side effects off the request's critical path and hands retries/backoff
# to a managed queue instead of a Redis + always-on worker (a poor fit for Cloud
# Run's scale-to-zero). Requests are authenticated with a Google-signed OIDC
# token minted as the dedicated invoker SA and verified in-app.

resource "google_cloud_tasks_queue" "email" {
  name     = "forward-email"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 10
  }

  # Transient handler failures (5xx — e.g. a mail-provider hiccup) are retried
  # with exponential backoff; a poison job (4xx) is dropped immediately.
  retry_config {
    max_attempts       = 8
    min_backoff        = "5s"
    max_backoff        = "3600s"
    max_doublings      = 5
    max_retry_duration = "86400s"
  }

  depends_on = [google_project_service.apis]
}

# The identity Cloud Tasks presents to the handler. Its OIDC token's `email`
# claim is what InternalJobsController authorizes against; it holds no project
# roles of its own (least privilege).
resource "google_service_account" "tasks_invoker" {
  account_id   = "forward-tasks-invoker"
  display_name = "Forward Cloud Tasks OIDC invoker"
}

# The runtime SA may enqueue tasks onto this queue…
resource "google_cloud_tasks_queue_iam_member" "runtime_enqueuer" {
  name     = google_cloud_tasks_queue.email.name
  location = google_cloud_tasks_queue.email.location
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.run_runtime.email}"
}

# …and to attach an OIDC token minted as the invoker SA, it must be able to
# actAs that SA.
resource "google_service_account_iam_member" "runtime_actas_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.run_runtime.email}"
}

# Defense in depth: the service is currently public (allUsers can invoke), but if
# it is ever locked down to IAM, the invoker SA must still be able to call it so
# OIDC-authenticated task deliveries keep working.
resource "google_cloud_run_v2_service_iam_member" "tasks_invoker" {
  name     = google_cloud_run_v2_service.server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks_invoker.email}"
}
