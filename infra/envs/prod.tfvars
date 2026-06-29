# Fill these in, then: terraform apply -var-file=envs/prod.tfvars
# Secret VALUES never go here — only in Secret Manager (see infra/README.md).

project_id      = "REPLACE_ME-gcp-project-id"
region          = "us-central1"
github_repo     = "dsasante1/forward"
hosting_site_id = "forward-dashboard"

# Non-secret runtime config for the server. Point the origins at your real
# dashboard URL once Hosting is live (default Firebase URL shown).
plain_env = {
  NODE_ENV                 = "production"
  SUPABASE_URL             = "https://REPLACE_ME.supabase.co"
  CLERK_AUTHORIZED_PARTIES = "https://forward-dashboard.web.app"
  CORS_ORIGINS             = "https://forward-dashboard.web.app"
  APP_BASE_URL             = "https://forward-dashboard.web.app"
  DEFAULT_FROM_EMAIL       = "Forward <no-reply@example.com>"
}
