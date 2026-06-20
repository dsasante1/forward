# Running Forward locally (SaaS architecture)

This is the closed-source, centrally-hosted setup: a **dashboard** (React/Vite) and
an **extension** talk to one **server** (NestJS) that owns auth, the database, and
the realtime bus. No client touches the database directly.

```
apps/dashboard  ─┐
apps/extension  ─┼──►  apps/server  ──►  Supabase Postgres
                 │      (Clerk auth,      (+ Supabase Realtime broadcast,
                 └───►   Mailtrap email)   Clerk for identity)
```

See [CLOSED-SOURCE-MIGRATION.md](CLOSED-SOURCE-MIGRATION.md) for the why, and
[apps/server/README.md](apps/server/README.md) / [apps/dashboard/README.md](apps/dashboard/README.md)
for per-surface detail.

## Prerequisites

- Node ≥ 20 (`.nvmrc` pins 22), npm.
- Accounts: **Supabase** (Postgres + Realtime), **Clerk** (auth), **Mailtrap** (email).

## 1. Configure secrets (never committed — all `.env*` are gitignored)

Copy the templates and fill them in:

```bash
cp apps/server/.env.example    apps/server/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

**`apps/server/.env`** (backend — holds every secret):

| Var | Where to get it |
|-----|-----------------|
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler** (`:6543`, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase → Connect → **Session pooler** (`:5432`) — used for migrations |
| `SUPABASE_URL` | Supabase → Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys → **secret** (`sb_secret_…`) — server only |
| `CLERK_SECRET_KEY` | Clerk → API Keys (`sk_…`) — written by `clerk init` |
| `MAILTRAP_API_KEY` | Mailtrap → Sending API token |
| `DEFAULT_FROM_EMAIL` | A sender on a **Mailtrap-verified** domain, e.g. `Forward <no-reply@yourdomain>` |
| `APP_BASE_URL` / `CORS_ORIGINS` | The dashboard origin, e.g. `http://localhost:5174` |

**`apps/dashboard/.env.local`** (frontend — public values only):

| Var | Where |
|-----|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk → API Keys (`pk_…`) |
| `VITE_API_BASE_URL` | The server, e.g. `http://localhost:8080` |
| `VITE_SUPABASE_URL` | Same Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → API Keys → **publishable** (`sb_publishable_…`) — never the secret |

> The Clerk **publishable/secret** pair and the Supabase **publishable/service-role**
> pair must each belong to the *same* instance, or tokens won't verify.

## 2. Install, build the contract, migrate the database

```bash
npm install
npm run build -w packages/shared           # the shared contract builds first
npm run prisma:generate -w apps/server
cd apps/server && npx prisma migrate deploy && cd ../..   # create the tables
```

## 3. Run (two terminals)

```bash
npm run start -w apps/server      # http://localhost:8080  (API + auth + email + realtime)
npm run dev   -w apps/dashboard   # http://localhost:5174  (sign up, projects, invites, tasks)
```

Open **http://localhost:5174**, sign up (Clerk), and create a project.

## 4. Smoke-check the flows

- **Auth** — sign up / sign in / reset are Clerk's hosted screens.
- **Projects & tasks** — create a project, add tasks (persist to Supabase).
- **Email invites + roles** — Members tab → invite an email as **viewer/editor/owner**;
  the invitee gets a Mailtrap email → accept link → joins with that role.
  (viewer = read-only, editor = read+write, owner = also manages members.)
- **Realtime** — open a project in two windows; a change in one appears in the
  other without refresh. (Optional: leave `VITE_SUPABASE_ANON_KEY` blank to disable.)

## Useful commands

```bash
npm test                       # all Vitest suites (contract)
npm run typecheck              # typecheck every workspace
npm run build                  # build every workspace
npm run prisma:migrate -w apps/server -- --name <name>   # new migration (interactive)
```

## Deploy (server)

`apps/server/Dockerfile` builds the workspace for Cloud Run / Fargate. The root
`.dockerignore` keeps `.env*`, `node_modules`, and `dist` out of the image — never
bake secrets in. Set the env vars above in your host's secret manager.
