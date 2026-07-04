resource "google_cloud_run_v2_service" "server" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.run_runtime.email

    # Every request holds a pooled DB connection for its whole (interactive-
    # transaction) duration, so per-instance concurrency must stay in the same
    # ballpark as the Prisma pool (connection_limit=10) — the default of 80
    # let bursts queue 8× past the pool (2026-07-02 outage).
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = 0 # scale to zero
      max_instance_count = var.max_instances
    }

    containers {
      # Bootstrap placeholder: Google's public "hello" image lets the service come
      # up healthy on the very first apply, before any of our images exist. The
      # deploy-backend workflow then swaps in the real :<git-sha> image, and the
      # lifecycle block below keeps that swap from showing as Terraform drift.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      # The startup probe must stay TCP: on service *creation* (first apply, or
      # a region move) the revision runs the hello bootstrap image above, which
      # has no /healthz — an HTTP startup probe would fail the create. The
      # liveness probe below is the one that matters for the 2026-07-02 outage
      # class (an instance whose Prisma pool is permanently starved serving
      # 500s forever): /healthz runs `SELECT 1` through the pool, and liveness
      # does not gate revision creation, so it flaps harmlessly on the
      # bootstrap image until CI deploys the real one. Probes hit the container
      # directly (the public URL intercepts /healthz at Google's front end, so
      # don't test it with curl).
      startup_probe {
        tcp_socket {
          port = 8080
        }
        period_seconds    = 10
        failure_threshold = 6
        timeout_seconds   = 5
      }

      liveness_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 30
        failure_threshold = 3
        timeout_seconds   = 5
      }

      # Secrets from Secret Manager (env var name == secret name).
      dynamic "env" {
        for_each = toset(var.secret_env_names)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      # Non-secret config: operator-supplied values plus the Terraform-computed
      # Cloud Tasks wiring (queue, self URL, invoker SA).
      dynamic "env" {
        for_each = merge(var.plain_env, local.cloud_tasks_env)
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  # Terraform owns the service shell; CI owns the image. Without this, every image
  # tag CI pushes would register as drift.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
      # The Cloud Run API auto-populates a service-level `scaling` block we never
      # declare (we set scaling under template), so it would otherwise show as a
      # perpetual no-op diff on every plan/apply.
      scaling,
    ]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.runtime_access,
    google_artifact_registry_repository.server,
    google_cloud_tasks_queue.email,
  ]
}

# The server authenticates callers itself (Clerk session tokens), so the service
# is publicly invocable.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
