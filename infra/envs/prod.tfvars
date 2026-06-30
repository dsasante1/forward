# Fill these in, then: terraform apply -var-file=envs/prod.tfvars
# Secret VALUES never go here — only in Secret Manager (see infra/README.md).

project_id      = "forward-500820"
region          = "us-central1"
github_repo     = "dsasante1/forward"
hosting_site_id = "forward-dashboard"

# Non-secret runtime config for the server. Point the origins at your real
# dashboard URL once Hosting is live (default Firebase URL shown).
plain_env = {
  NODE_ENV                 = "production"
  SUPABASE_URL             = "https://yvhstswanvrkriuyuuly.supabase.co"
  CLERK_AUTHORIZED_PARTIES = "https://forward-dashboard.web.app"
  CORS_ORIGINS             = "https://forward-dashboard.web.app"
  APP_BASE_URL             = "https://forward-dashboard.web.app"
  DEFAULT_FROM_EMAIL       = "verbgh <services@verbgh.com>"
}
