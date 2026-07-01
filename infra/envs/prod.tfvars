# Fill these in, then: terraform apply -var-file=envs/prod.tfvars
# Secret VALUES never go here — only in Secret Manager (see infra/README.md).

project_id      = "forward-500820"
region          = "us-central1"
github_repo     = "dsasante1/forward"
hosting_site_id = "forward-dashboard"

# Cost ceiling: Cloud Run scales to zero, so idle = $0. This bounds the worst
# case — even under load/attack you never pay for more than this many instances.
# Lower it (e.g. 2) for a tighter cap; raise it if you need more throughput.
max_instances = 4

# Non-secret runtime config for the server. Point the origins at your real
# dashboard URL once Hosting is live (default Firebase URL shown).
# NODE_ENV and CORS_ORIGINS are intentionally NOT here — they are sourced from
# Secret Manager (see secret_env_names) so each environment carries its own value.
plain_env = {
  SUPABASE_URL             = "https://yvhstswanvrkriuyuuly.supabase.co"
  CLERK_AUTHORIZED_PARTIES = "https://forward-dashboard.web.app"
  APP_BASE_URL             = "https://forward-dashboard.web.app"
  DEFAULT_FROM_EMAIL       = "verbgh <services@verbgh.com>"
}
