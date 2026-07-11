# forward-server

The central API and trust boundary: it owns authentication, the database, tenancy,
and the realtime sync bus. No client ever touches the database directly.

Stack (as chosen): **NestJS · Prisma · Supabase Postgres · Clerk · Supabase
Realtime · Google Cloud Run.**

## What the server owns

- Clients call this API; it is the only DB writer.
- `ClerkAuthGuard` (authn) + `MembershipGuard` (per-project authz) + Postgres RLS enforce access.
- Every request carries a per-user bearer token (`Authorization: Bearer <token>`), no admin powers.
- The server stamps identity + time (`author` / `timestamp` / `updatedAt`) from the session.
- The `VersionEntry` table is **INSERT-only** (history is not rewritable).
- Every write is re-validated with the **same `forward-core` Zod** schemas.
- **Supabase Realtime** broadcasts on `project:<id>` after each write.

The flexible per-layer shapes (`DesignElement`, `InfraNode`, `Task`, …) are stored
in `data JSONB` columns and validated by `forward-core` on write, so the data
contract stays single-sourced across canvas, extension, MCP, and this server.

## Layout

```
prisma/schema.prisma   data model (Supabase Postgres)
prisma/rls.sql         Row-Level Security policies (defense-in-depth)
src/auth/              Clerk verification + @CurrentUser / @Public
src/common/            ZodBody pipe, MembershipGuard, sanitize, RealtimeService
src/prisma/            PrismaService (incl. withUser() that sets app.user_id)
src/projects/          projects + member roster
src/elements/          design elements + apiBinding + append-only timeline
src/infra/             infra nodes / edges / flows
src/tasks/             task tracker
src/main.ts            bootstrap (helmet, CORS, global pipes)
```

## API surface

All routes require `Authorization: Bearer <clerk-session-token>` (except
`GET /healthz`). Project-scoped routes additionally require roster membership.

```
POST   /projects                              create (caller becomes owner)
GET    /projects?q=&sort=recent|name          list mine (role, favorite, member preview, edited)
PATCH  /projects/:p                 (owner)    rename { name }
DELETE /projects/:p                 (owner)    delete project (cascades everything under it)
POST   /projects/:p/duplicate                 deep-copy elements/infra/tasks into a new project I own
PUT    /projects/:p/favorite                  star / unstar for me { favorite }
GET    /projects/:p/members                   roster
POST   /projects/:p/members        (owner)    add { userId, role }
DELETE /projects/:p/members/:userId (owner)   remove

GET    /projects/:p/elements
PUT    /projects/:p/elements/:id              create/replace (DesignElement)
PATCH  /projects/:p/elements/:id              partial update
DELETE /projects/:p/elements/:id?cascade=     delete (+ subtree by default)
PUT    /projects/:p/elements/:id/binding      attach apiBinding + version entry
DELETE /projects/:p/elements/:id/binding      remove apiBinding + version entry
GET    /projects/:p/timeline                  histories keyed by element id

GET    /projects/:p/infra                     nodes + edges + flows
PUT    /projects/:p/infra/nodes/:id           · DELETE …/nodes/:id (cascades edges)
PUT    /projects/:p/infra/edges/:id           · DELETE …/edges/:id
PUT    /projects/:p/infra/flows/:id           · DELETE …/flows/:id

GET    /projects/:p/tasks
PUT    /projects/:p/tasks/:id                 · DELETE …/tasks/:id
```

## Local setup

```bash
# from the repo root
npm install
npm run build -w packages/shared          # the contract must build first
cp apps/server/.env.example apps/server/.env   # fill in Supabase + Clerk values

npm run prisma:generate -w apps/server    # regenerate the typed client
npm run prisma:migrate  -w apps/server    # apply existing migrations (creates the DB schema)
psql "$DIRECT_URL" -f apps/server/prisma/rls.sql   # optional: enable RLS

npm run build -w apps/server
npm run start -w apps/server              # listens on :8080 (or npm run dev for watch mode)
```

### Database migrations

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma); migrations are committed under `prisma/migrations/`.

```bash
# Create + apply a new migration after editing schema.prisma (dev DB):
npm run prisma:migrate -w apps/server -- --name <change_name>

# Apply already-committed migrations without generating new ones (CI / prod):
npm run prisma:deploy  -w apps/server

# Regenerate the typed client only (no DB change — e.g. after pulling schema edits):
npm run prisma:generate -w apps/server
```

> Use the Supabase **session** pooler (port 5432) in `DATABASE_URL`/`DIRECT_URL` — the
> transaction pooler (6543) breaks the `SET LOCAL` calls that drive RLS.

## Deploy (Cloud Run)

```bash
gcloud run deploy forward-server \
  --source . \
  --region <region> \
  --set-env-vars "DATABASE_URL=...,DIRECT_URL=...,SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,CLERK_SECRET_KEY=...,CORS_ORIGINS=..."
```

(The repo-root `apps/server/Dockerfile` builds the workspace so `forward-core`
is included; `--source .` uses it.)

## How the surfaces connect

Every surface goes through `forward-core/api`, sending its token as
`Authorization: Bearer …`:

- **Canvas** — signs in with Clerk's web SDK; subscribes to the project's Supabase
  Realtime channel with the **anon** key; mutates via this API.
- **Extension** — authenticates with a `fwd_pat_…` Personal Access Token kept in
  VS Code SecretStorage, and calls this API.
- **MCP** — uses a `fwd_pat_…` Personal Access Token supplied via env.

## Status / not yet done

- `npm install` + `prisma generate` have **not** been run here, so the workspace
  is unbuilt; types resolve once dependencies are installed.
- No automated tests yet (add Vitest suites mirroring the other workspaces).
- Realtime is broadcast-only (server → clients). Clients re-fetch on a change
  event. Swap to Supabase Postgres CDC subscriptions later if you prefer.
- Add rate-limiting + per-tenant quotas (Redis) before going public.
</content>
