# Forward infrastructure (Terraform)

Provisions the all-GCP deploy: **Cloud Run** (backend `apps/server`) + **Firebase
Hosting** (frontend `apps/dashboard`), with **Supabase** as the external Postgres +
realtime bus. Terraform owns the durable infrastructure; GitHub Actions deploys the
code (see `.github/workflows/deploy-*.yml`).

## Division of responsibility

| Owns | What |
|------|------|
| **Terraform** (this dir) | APIs, Artifact Registry, the Cloud Run service *shell*, Secret Manager containers, service accounts + IAM, Firebase project + Hosting site, Workload Identity Federation |
| **CI (deploy-backend)** | builds the image, runs `prisma migrate deploy`, deploys a new Cloud Run revision |
| **CI (deploy-frontend)** | builds the dashboard with `VITE_*`, runs `firebase deploy --only hosting` |
| **You (out-of-band, once)** | the state bucket, secret *values*, GitHub repo vars/secrets |

Terraform never sees the container image tag (lifecycle `ignore_changes`) nor any
secret value — so CI rolling new images and you rotating credentials never cause
state drift.

## One-time bootstrap

Run locally with an account that has Owner (or equivalent) on the GCP project.

```bash
# 0. Auth as yourself for the bootstrap apply.
gcloud auth application-default login
gcloud config set project <PROJECT_ID>

# 1. Create the Terraform state bucket (Terraform can't create its own backend).
gsutil mb -l us-central1 gs://<PROJECT_ID>-forward-tfstate
gsutil versioning set on gs://<PROJECT_ID>-forward-tfstate

# 2. Fill in infra/envs/prod.tfvars (project_id, SUPABASE_URL, real origins…).

# 3. Init + apply.
cd infra
terraform init -backend-config="bucket=<PROJECT_ID>-forward-tfstate"
terraform apply -var-file=envs/prod.tfvars
```

The Cloud Run service comes up on first apply using Google's public `hello` image
as a placeholder; CI replaces it with the real image on the first backend deploy.

### Add the secret values (once, and on rotation)

Terraform created empty secret containers. Add a version to each:

```bash
printf '%s' '<value>' | gcloud secrets versions add DATABASE_URL              --data-file=-
printf '%s' '<value>' | gcloud secrets versions add DIRECT_URL                --data-file=-
printf '%s' '<value>' | gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=-
printf '%s' '<value>' | gcloud secrets versions add CLERK_SECRET_KEY          --data-file=-
printf '%s' '<value>' | gcloud secrets versions add MAILTRAP_API_KEY          --data-file=-
```

Use the Supabase **session** pooler (port 5432) for `DATABASE_URL`/`DIRECT_URL` —
the transaction pooler (6543) breaks the server's `SET LOCAL` RLS (see
`apps/server/.env.example`).

### Wire GitHub (from the Terraform outputs)

```bash
terraform output   # cloud_run_url, wif_provider, app_deployer_sa, tf_deployer_sa, …
```

Set these on the GitHub repo (`Settings → Secrets and variables → Actions`):

**Repository *variables*** (non-secret):

| Variable | Value |
|----------|-------|
| `GCP_PROJECT_ID` | your project id |
| `GCP_WIF_PROVIDER` | `wif_provider` output |
| `GCP_APP_DEPLOYER_SA` | `app_deployer_sa` output |
| `GCP_TF_DEPLOYER_SA` | `tf_deployer_sa` output |
| `TF_STATE_BUCKET` | `<PROJECT_ID>-forward-tfstate` |
| `VITE_API_BASE_URL` | `cloud_run_url` output |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_…` (anon, never service-role) |

**Repository *secrets*** (used only by the migration step):

| Secret | Value |
|--------|-------|
| `MIGRATE_DATABASE_URL` | Supabase session-pooler URL |
| `MIGRATE_DIRECT_URL` | Supabase session-pooler URL |

## Day-to-day

- Change `apps/server` or `packages/shared` → **deploy-backend** builds, migrates, deploys.
- Change `apps/dashboard` (or `apps/canvas`) → **deploy-frontend** builds + deploys Hosting.
- Change `infra/**` → **infra** plans on PRs, applies on merge to `master`.

## Notes & gotchas

- **Bootstrap order**: the state bucket and the first `terraform apply` (which
  creates the WIF pool) cannot run through the pipeline that depends on them — hence
  the manual bootstrap above. After that, everything is automated.
- **State is sensitive**: it can contain resource metadata; keep the bucket private
  and versioned (done above). Secret *values* are not in state — only containers.
- **Firebase Hosting content** is deployed by the `firebase` CLI in CI, not by
  Terraform. Terraform only provisions the project + site.
- **Tightening IAM**: `tf_deployer_roles` (in `variables.tf`) is intentionally broad
  so the infra workflow can manage IAM/WIF. Narrow it once the resource set is stable.
