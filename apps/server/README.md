# forward-server

The backend that replaces Forward's original Firebase-direct model. It is the
**one component the old architecture deliberately omitted**: a central API that
owns authentication, the database, tenancy, and the realtime sync bus. No client
ever touches the database directly anymore.

Stack (as chosen): **NestJS · Prisma · Supabase Postgres · Clerk · Supabase
Realtime · Google Cloud Run.**

## How it maps to the old model

| Old (Firebase-direct) | Now (this server) |
|---|---|
| Each client wrote the user's own Firebase RTDB directly | Clients call this API; it is the only DB writer |
| Firebase security rules (`apps/canvas/firebase.rules.json`) | `ClerkAuthGuard` (authn) + `MembershipGuard` (per-project authz) + Postgres RLS |
| Extension's Firebase **admin secret** that bypassed rules | Per-user **Clerk** bearer token, no admin powers |
| `?auth=<token>` in the query string | `Authorization: Bearer <token>` header only |
| Client-set `author` / `timestamp` / `updatedAt` | Server stamps identity + time from the session |
| `version_timeline` writable (history rewritable) | `VersionEntry` table is **INSERT-only** |
| Client-side Zod validation only | Server re-validates every write with the **same `forward-core` Zod** |
| Firebase `onValue` / ETag polling = the sync bus | **Supabase Realtime** broadcast on `project:<id>` after each write |

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
GET    /projects                              list mine
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

npm run prisma:generate -w apps/server
npm run prisma:migrate  -w apps/server -- --name init
psql "$DIRECT_URL" -f apps/server/prisma/rls.sql   # optional: enable RLS

npm run build -w apps/server
npm run start -w apps/server              # listens on :8080
```

## Deploy (Cloud Run)

```bash
gcloud run deploy forward-server \
  --source . \
  --region <region> \
  --set-env-vars "DATABASE_URL=...,DIRECT_URL=...,SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,CLERK_SECRET_KEY=...,CORS_ORIGINS=..."
```

(The repo-root `apps/server/Dockerfile` builds the workspace so `forward-core`
is included; `--source .` uses it.)

## Connecting the existing surfaces

The migration is a one-module swap, because every surface already goes through
`forward-core`. Replace the Firebase REST calls in
`packages/shared/src/rtdb-rest.ts` (and the canvas `LiveSource`) with `fetch`
calls to this API that send the Clerk token as `Authorization: Bearer …`:

- **Canvas** — sign in with Clerk's web SDK; subscribe to the project's Supabase
  Realtime channel with the **anon** key; mutate via this API.
- **Extension** — authenticate with `vscode.authentication` (OAuth), store the
  token in `context.secrets`, and call this API. **Delete `forward.authToken`** —
  the admin secret is gone.
- **MCP** — use a per-tenant service token issued by this API.

## Status / not yet done

- `npm install` + `prisma generate` have **not** been run here, so the workspace
  is unbuilt; types resolve once dependencies are installed.
- No automated tests yet (add Vitest suites mirroring the other workspaces).
- Realtime is broadcast-only (server → clients). Clients re-fetch on a change
  event. Swap to Supabase Postgres CDC subscriptions later if you prefer.
- Add rate-limiting + per-tenant quotas (Redis) before going public.
</content>
