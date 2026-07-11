# Forward

A developer-first tool that keeps **design and backend documentation in sync**. Designers draw UI
on an independent visual canvas; backend developers then annotate those design elements — straight
from VS Code or an AI agent — with API, infrastructure, data-model and UML documentation, alongside
a historical (timeline) view of how the work has changed over time. Organizations and users sign up,
manage members, and track tasks against the design, so the UI, its documentation and the work all
live in one place.

Forward runs on a **centrally-hosted backend** ([apps/server](apps/server) — NestJS · Prisma ·
Supabase Postgres · Clerk) that owns authentication, sign-up, the database, tenancy and the realtime
sync bus. The dashboard, canvas, VS Code extension and MCP server all talk to that server through the
shared `forward-core` contract.

```
   designers                backend devs                AI agents
      │                          │                          │
 [ web canvas ]           [ VS Code extension ]        [ MCP server ]
      │                          │                          │
      └──────────► apps/server (REST + Realtime) ◄──────────┘
                   Postgres · Clerk · Supabase
```

## Seven data layers, one contract

The data model is deliberately layered. The **design** is the primary artefact and exists on its own;
everything else is optional and attaches (or links) to it. All shapes live once in
[packages/shared](packages/shared) (`forward-core`) as Zod schemas + TypeScript types, so every surface
stays in sync.

| Layer | What it is | Attaches to |
|---|---|---|
| **Design** | `DesignElement`s a designer draws — frames, rectangles, ellipses, text, components/instances — with absolute geometry, `parentId` hierarchy and style | — (stands alone) |
| **API binding** | An *optional* `{ title, description }` doc note a backend dev attaches to a design element. Docs-first and framework-agnostic (REST, GraphQL, gRPC, a job…) — an endpoint is never a first-class canvas object | one design element |
| **Infrastructure** | A project-scoped graph of `InfraNode`s + `InfraEdge`s (frontend, backend, db, cache, queue, service, devops, external, group), rendered as an overlay | project |
| **Flows** | Narrated `InfraFlow`s — ordered hops over the infra nodes — that serialize to a Mermaid `sequenceDiagram` and can tie a hop to an endpoint | infra graph |
| **Entities (ER/UML)** | A project-scoped data model of `Entity` tables + crow's-foot `EntityRelation`s, serialized to a Mermaid `erDiagram` | project |
| **Tasks** | A work tracker (`Task`: status/priority/type, assignees, `dependsOn`, activity feed) that *optionally links* into a design element / flow / endpoint, with a Gantt view | project (soft links) |
| **Checkpoints** | Named, restorable snapshots of the whole canvas (design + infra) — a deliberate save with a note | project |

On top of these sits the **History timeline**: a per-element append-only API-doc history
(`version_timeline`) plus a unified project event feed, rendered as a git-graph with expandable
"git-diff for API docs" and a **catch-up digest** ("since this baseline, here's what to integrate /
modify / remove") for a returning frontend dev.

## Monorepo layout

npm workspaces (Node >= 20; `.nvmrc` pins 22).

| Path | Package | What it is |
|---|---|---|
| [packages/shared](packages/shared) | `forward-core` | The contract: Zod schemas + types, the timeline/diff/infra/entity helpers, and the `api-rest` data client for the central server (exported as `forward-core/api`) |
| [apps/server](apps/server) | — | Central backend API (NestJS · Prisma · Supabase Postgres · Clerk): auth, sign-up, tenancy, RBAC, invites, tokens, the realtime bus, and CRUD for every data layer |
| [apps/dashboard](apps/dashboard) | `forward-dashboard` | React SPA (Vite + Clerk) for orgs/projects/tasks/docs/members — and the host that embeds the canvas. Includes the org-admin portal |
| [apps/canvas](apps/canvas) | `forward-canvas` | design editor, consumed **only as an embedded library** (`forward-canvas/embed`). Renders timeline/infra/ER diagrams via Mermaid |
| [apps/extension](apps/extension) | `forward-vscode` | VS Code extension: pick a design element → write API/infra/flow/task docs onto it. Talks to the central server with a Clerk session token |
| [apps/mcp](apps/mcp) | `forward-mcp` | MCP server giving any AI agent full parity with the canvas (~30 tools). Talks to the central server via `forward-core/api` |
| [apps/admin](apps/admin) | `forward-admin` | Platform-admin SPA — cross-tenant staff console (overview, orgs, users, projects, billing, audit) |
| [infra](infra) | — | Terraform for the GCP deployment (Cloud Run, Firebase Hosting, Artifact Registry, Secret Manager, Workload Identity) |

## Commands

Run from the repo root:

```bash
npm install          # install all workspaces
npm run build        # build every workspace (packages/shared builds before the apps)
npm test             # run all Vitest suites
npm run typecheck    # typecheck all workspaces
npm run bootstrap    # install → build
```

Per-workspace with `-w`, e.g. a single test file or test name:

```bash
npm test -w packages/shared -- src/schema.test.ts
npm test -w packages/shared -- -t "name fragment"
```

### Backend server ([apps/server](apps/server))

Needs `apps/server/.env` (copy from `.env.example`): `DATABASE_URL` / `DIRECT_URL` (Supabase
Postgres), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `REALTIME_CHANNEL_SECRET` (the realtime
bus), `CLERK_SECRET_KEY` + `CLERK_AUTHORIZED_PARTIES` + `CLERK_WEBHOOK_SIGNING_SECRET`, and
`CORS_ORIGINS` (an explicit allow-list — the server refuses to boot in production without one).

```bash
npm run dev -w apps/server             # watch mode, listens on :8080
npm run prisma:migrate -w apps/server  # apply/create a migration after editing schema.prisma
npm run prisma:deploy -w apps/server   # apply committed migrations (CI/prod)
```

### Front-ends

```bash
npm run dev -w apps/dashboard   # dashboard + embedded canvas (needs VITE_API_BASE_URL, VITE_CLERK_PUBLISHABLE_KEY, VITE_SUPABASE_URL/ANON_KEY)
npm run dev -w apps/admin       # platform-admin console (needs VITE_API_BASE_URL, VITE_CLERK_PUBLISHABLE_KEY)
npm run package -w apps/extension   # build the VS Code .vsix locally
```

The canvas is **not** a standalone app — open it in the dashboard at
`/app/projects/:projectId/canvas` (a project's Documentation tab → "Open project in canvas").

## Using the surfaces

- **Canvas** — Toolbar (Move, Frame, Rect, Ellipse, Text, Comp, Inst, Del); drag to draw, drag a
  handle to resize, drop inside a frame to nest. The right panel edits geometry/style, shows the API
  binding the backend attached, and the endpoint's version history. The **History** toggle opens the
  git-graph timeline + catch-up digest; the **Infra** overlay draws the architecture graph and flows.
- **VS Code extension** — Sign in (`forward.signIn`) against your Forward server, then use the
  `forward.*` commands to connect an endpoint's docs to a design element, edit the infra graph and
  flows, and file/update tasks. Configure `forward.apiBaseUrl` and `forward.projectId` in Settings.
- **MCP server** — Point any MCP-capable agent at it (env: `FORWARD_API_BASE_URL`,
  `FORWARD_PROJECT_ID`, `FORWARD_API_TOKEN` — a `fwd_pat_…` PAT). Already using the extension? Run
  **Forward: Set Up MCP for AI Agents** (`forward.setupMcp`) to copy a ready `claude mcp add …` line
  that reuses your existing token — a PAT is user-scoped, so no second token is needed. Restart the
  agent session afterwards to load the tools. The agent gets scoped tools with full parity: author
  and document elements, edit the infra/ER graphs and flows, read the timeline/catch-up digest, and
  manage members.

A **project id** is a tenancy namespace (e.g. `project_xyz`), **not** a GCP project id. The
extension's `forward.projectId` and the canvas's project must match to share elements.

## Access control & tenancy

The server is the trust boundary. **Organizations** (mirrored from Clerk) are the top tenancy tier;
**projects** are the unit of isolation, each with a member roster and per-project roles —
`viewer` (read), `editor` (read/write the data layers), `owner` (also manages the roster + invites).
Ownership is claimed on create and enforced server-side (a `FOR UPDATE` lock guards the
"can't remove the last owner" rule). Owners invite by email (a tokenized link); the extension
authenticates with either a Clerk session token or a project **API token**. A separate
**platform-admin** tier ([apps/admin](apps/admin)) sees across all tenants and writes every mutation
to an audit trail.

The realtime bus is Supabase Realtime: after each write the server broadcasts a compact change event
on a per-project channel whose name is an HMAC of the project id (a capability handed only to
members), so clients re-fetch without touching the database directly.

## Publishing

Pushing a `v*` tag triggers [.github/workflows/release.yml](.github/workflows/release.yml) to build,
test, package the extension `.vsix`, and publish to the VS Code Marketplace + Open VSX (each skipped
if its `VSCE_PAT` / `OVSX_PAT` secret is absent). Bump with
`npm version patch -w apps/extension && git push --follow-tags`.
