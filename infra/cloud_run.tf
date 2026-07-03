resource "google_cloud_run_v2_service" "server" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.run_runtime.email

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
