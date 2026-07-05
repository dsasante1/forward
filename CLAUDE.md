# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Forward is a developer-first tool. Designers draw UI on an independent visual canvas; backend developers (from VS Code or an AI agent) annotate those design elements with API, infrastructure, data-model and UML documentation, plus a historical (timeline) view of how development has changed over time — keeping frontend and backend in sync. Organizations and users sign up, manage members, and track tasks against the design.

Forward runs on a **centrally-hosted backend** (`apps/server` — NestJS/Prisma/Supabase Postgres/Clerk) that owns auth, sign-up, the database, tenancy, RBAC, and the realtime sync bus. The migration onto it is **complete**: the dashboard, canvas, VS Code extension **and the MCP server** all talk to the server through `forward-core/api`. Firebase is retired — the legacy Firebase client (`rtdb-rest`) remains in `forward-core` only as the `api-rest` signature twin and for the canvas's standalone mock-RTDB dev fallback; no deployed surface uses it.

## Commands

Run from the repo root (npm workspaces; Node >= 20, `.nvmrc` pins 22).

- `npm install` — install all workspaces
- `npm run build` — build every workspace (`packages/shared` must build before the apps that import it)
- `npm test` — run all Vitest suites across workspaces
- `npm run typecheck` — typecheck all workspaces
- The web canvas is no longer a standalone app — it is embedded by the dashboard (`apps/dashboard`, route `/app/projects/:projectId/canvas`). Run it via `npm run dev -w apps/dashboard`.
- `npm run setup` — interactive Firebase config writer (`.vscode/settings.json`, `firebase.json`/`.firebaserc`, deploys rules) for the **legacy Firebase path** (retired; kept only for the mock-RTDB dev fallback)
- `npm run bootstrap` — `install` → `build` → `setup`

Backend server (`apps/server` — NestJS/Prisma/Supabase/Clerk; needs `apps/server/.env`, copy from `.env.example`):
- `npm run dev -w apps/server` — run the API in watch mode (listens on :8080); `npm run start -w apps/server` runs the built server
- `npm run prisma:migrate -w apps/server` — apply migrations, or create one after editing `schema.prisma` with `-- --name <change>`; `prisma:deploy` applies committed migrations in CI/prod; `prisma:generate` regenerates the typed client only
- Migrations are committed under `apps/server/prisma/migrations/`; the dashboard and admin SPA reach the server via `VITE_API_BASE_URL` (e.g. `http://localhost:8080`)

Front-ends: `npm run dev -w apps/dashboard` (dashboard + embedded canvas) and `npm run dev -w apps/admin` (platform-admin console). Both are Vite + Clerk.

Per-workspace (use `-w <workspace>`, e.g. `npm test -w packages/shared`):
- A single test file: `npm test -w packages/shared -- src/schema.test.ts`
- A single test by name: `npm test -w packages/shared -- -t "name fragment"`
- Build the extension `.vsix` locally: `npm run package -w apps/extension`

The extension is bundled with **esbuild** (`apps/extension/esbuild.mjs`), not tsc — `npm run build -w apps/extension` runs esbuild; `typecheck` runs tsc separately for both the node and webview tsconfigs.

## Architecture

### The contract is the center: `packages/shared` (`forward-core`)

Everything depends on this package; the apps depend on each other only through it. It is the **single source of truth** for every data shape — change it here once and all surfaces follow. Key modules:

- `schema.ts` — Zod schemas + TS types for all seven data layers, **plus `paths`** (the one place Firebase RTDB paths are constructed — always use it on the Firebase/MCP path, never hand-build a path string). The same schemas validate the JSON columns the server stores in Postgres, so both backends speak the identical contract.
- `rtdb-rest.ts` — a thin `fetch`-based **Firebase RTDB REST client**. It speaks the full contract (create/update/delete elements, document them, edit the infra/ER graphs and flows, manage tasks/members) and is the writer for the **MCP** surface.
- `api-rest.ts` — the **central-server client**, exported as `forward-core/api`. A deliberate drop-in twin of `rtdb-rest`: every function mirrors its name, argument order and return type, so a surface migrates by swapping the import and passing an `ApiConfig` (`baseUrl` + `projectId` + Clerk/API `token`) instead of a `FirebaseConfig`. It sends a `Bearer` token, never touches the DB directly, and lets the server own identity + timestamps. Used by the **canvas** (`ServerSource`) and the **extension**.
- `api-diff.ts` — the "git-diff for API docs": diffs two `apiBinding`s (title change + line-level Markdown diff) into the structured `VersionDiff` the History timeline expands.
- `timeline.ts` — pure helpers that flatten per-element `version_timeline` histories into one chronological event stream, lay it out as git-graph lanes, and collapse it into a catch-up digest (to-integrate / to-modify / to-remove since a baseline).
- `infra-flow.ts` — the infrastructure graph + narrated flows logic; serializes flows to a Mermaid `sequenceDiagram` and the graph to a component diagram.
- `entity.ts` — the ER/data-model layer; serializes entities + crow's-foot relations to a Mermaid `erDiagram`.
- `tasks.ts` — task-tracker helpers (keys, activity, ordering).
- `rtdb.ts` — `normalizeList`: RTDB has no real arrays; a push-keyed object and a literal array can both represent the same list, so **always normalize lists on read** (Firebase path).

### Seven intentionally-separate data layers

The **design** layer is primary and stands alone; every other layer is optional and either *attaches to* a design element or *links* to one by id (soft references resolved on read, never enforced foreign keys).

1. **Design** — `DesignElement`s a designer draws (frame, rectangle, ellipse, text, component, instance) with absolute geometry and `parentId` hierarchy. The primary artefact; exists on its own.
2. **API binding** — an *optional* `apiBinding` (`{ title, description }`) a backend dev attaches to a design element. Most elements never get one; an endpoint is never a first-class canvas object. Docs-first and framework-agnostic (Markdown `description` carries the meaning).
3. **Infrastructure** — an *optional*, project-scoped graph of `InfraNode`s + `InfraEdge`s, rendered as a separate overlay. Not attached to any design element.
4. **Flows** — narrated `InfraFlow`s: ordered hops over the infra nodes; a hop may tie to an endpoint (`endpointId`). Render as numbered arrows and serialize to a Mermaid sequence diagram.
5. **Entities (ER/UML)** — an *optional*, project-scoped data model of `Entity` tables + `EntityRelation`s (crow's-foot cardinality). Its own graph; serializes to a Mermaid `erDiagram`.
6. **Tasks** — an *optional*, project-scoped tracker (`Task`: status/priority/type, assignees, `dependsOn`, activity feed). Stands apart but each task optionally *links* into the other layers (`elementId` / `flowId` / `endpointId`).
7. **Checkpoints** — *optional*, named, restorable snapshots of the whole canvas (design + infra), each with a note and per-layer change counts.

On top sit the **timelines**: the per-element append-only `version_timeline` (API-doc history) and a unified project event feed (`ProjectTimelineEvent`, domain-tagged design/api/infra/uml), driving the History git-graph, doc diffs and catch-up digest.

A "project id" is a **tenancy namespace** (e.g. `project_xyz`), **not** a GCP project id. The canvas's `VITE_CANVAS_PROJECT_ID` and the extension's `forward.projectId` must match for the two sides to share elements.

### The surfaces (`apps/*`)

- **`apps/server`** — the central NestJS API and trust boundary. Feature modules mirror the layers/tiers: `projects` (tenancy + roster), `invites`, `tokens` (extension API tokens), `elements`, `infra`, `tasks`, `checkpoints`, `timeline`, `orgs` (Clerk-mirrored), `webhooks` (Svix-verified Clerk sync), `admin` (platform tier), plus `auth` (global Clerk guard), `common` (guards, realtime bus, email, sanitize) and `prisma`. Boots with helmet, a fail-closed CORS allow-list, and a global validation pipe. Data lives in Postgres as validated JSON columns (see `prisma/schema.prisma`).
- **`apps/dashboard`** (`forward-dashboard`) — React SPA (Vite + Clerk) for orgs/projects/tasks/docs/members, the org-admin portal, and the host that embeds the canvas.
- **`apps/canvas`** (`forward-canvas`) — vanilla-TS Figma-lite editor, consumed **only as an embedded library** (no standalone app). Exports `mountCanvas` + `ServerSource` via `forward-canvas/embed` (`src/embed.ts`); the dashboard's `CanvasPage` mounts it into a Shadow DOM with a Clerk-token-backed `ServerSource` (the backend REST API via `forward-core/api`). The `CanvasSource` interface lives in `src/source.ts`; styles are injected from `src/canvas.css` (`?inline`); diagrams render via `mermaid`. A `VITE_MOCK_RTDB_URL` fallback exists for standalone dev.
- **`apps/extension`** (`forward-vscode`) — VS Code extension. Talks to the **central server** via `forward-core/api`, authenticating with a Personal Access Token (a `fwd_pat_…` PAT pasted via `forward.signIn` and kept in VS Code SecretStorage) — the long-lived, user-scoped stand-in for a Clerk session JWT that headless surfaces use; configured by `forward.apiBaseUrl` + `forward.projectId` (the project chosen interactively via `forward.selectProject`). Contributes the `forward.*` commands (connect endpoint, edit infra/flows, file/update tasks, select project) and settings.
- **`apps/mcp`** (`forward-mcp`) — Model Context Protocol server giving any AI agent full parity with the canvas/extension (~30 scoped tools). Talks to the **central server** via `forward-core/api`, authenticating with the same `fwd_pat_…` PAT model as the extension (a user-scoped credential the server resolves to its owner's access): the process holds `FORWARD_API_BASE_URL`, `FORWARD_PROJECT_ID`, `FORWARD_API_TOKEN`; the difference is only delivery — ambient env vars here vs. interactive paste + SecretStorage in the extension, since no human is present. The agent only ever sees the scoped tools. `match.ts` (fuzzy feature→element matching) and `anchor.ts` (deterministic `@adc <id>` source markers) power element resolution.
- **`apps/admin`** (`forward-admin`) — the platform-admin SPA (Vite + Clerk): a cross-tenant staff console (overview, orgs, users, projects, billing, audit) served by the server's `admin` module behind `PlatformAdminGuard`.

### Access control & tenancy

The **server enforces access** (the primary path). **Organizations** (mirrored from Clerk) are the top tenancy tier; **projects** are the unit of isolation, each with a member roster and per-project `ProjectRole` — `viewer` (read), `editor` (read/write data layers), `owner` (also manages roster + invites). Ownership is claimed on create; the "can't remove/demote the last owner" rule is guarded by a `FOR UPDATE` row lock. Membership/role is checked by `MembershipGuard`/`@RequireOwner`; the platform-admin tier bypasses tenancy and writes every mutation to an audit trail. The realtime bus (Supabase) broadcasts change events on a per-project channel whose name is an HMAC of the project id — a capability handed only to members via a guarded route.

The **legacy Firebase path** (retired — no deployed surface uses it) was gated by the per-project membership ACL in `apps/canvas/firebase.rules.json`; the rules file remains only alongside the mock-RTDB dev fallback.

## Conventions

- ESM throughout (`"type": "module"`); strict TS with `noUncheckedIndexedAccess`.
- **Change any data layer in `packages/shared` first** (schema + `paths`), then propagate to *both* clients (`rtdb-rest` and `api-rest` — keep them signature-identical), the server module that persists it, and the consuming apps. Never duplicate a path string or shape in an app.
- The server owns identity + timestamps: an `author` passed by a client on the `api-rest` path is ignored — the session decides who wrote it.
- Local config (Firebase URLs, tokens, `.env`/`.env.local`, `.vscode/settings.json`) is read from local settings/env and is **never committed**.

## Publishing

Pushing a `v*` tag triggers `.github/workflows/release.yml` to build, test, package the `.vsix`, and publish to the VS Code Marketplace + Open VSX (each skipped if its `VSCE_PAT`/`OVSX_PAT` secret is absent). Bump via `npm version patch -w apps/extension && git push --follow-tags`.
