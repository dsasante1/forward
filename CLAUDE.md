# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Forward is a developer-first tool. Designers draw UI on an independent visual canvas; backend developers annotate those design elements — from VS Code — with API, infrastructure, and UML documentation, plus a historical (timeline) view of how development has changed over time, keeping frontend and backend in sync. Organizations and users sign up, manage members, and set up tasks for developers. The product is migrating to a centrally-hosted model: a backend API (`apps/server` — NestJS/Prisma/Clerk/Supabase) owns auth, sign-up, the database, tenancy, and the realtime sync bus. The original surfaces (canvas, extension, MCP) still talk to a Firebase Realtime Database directly through `forward-core`; that one module is the swap point onto the new server.

## Commands

Run from the repo root (npm workspaces; Node >= 20, `.nvmrc` pins 22).

- `npm install` — install all workspaces
- `npm run build` — build every workspace (`packages/shared` must build before the apps that import it)
- `npm test` — run all Vitest suites across workspaces
- `npm run typecheck` — typecheck all workspaces
- The web canvas is no longer a standalone app — it is embedded by the dashboard (`apps/dashboard`, route `/app/projects/:projectId/canvas`). Run it via `npm run dev -w apps/dashboard`.
- `npm run setup` — interactive Firebase config writer (`.vscode/settings.json`, `firebase.json`/`.firebaserc`, deploys rules) for the extension/MCP, which still use the Firebase RTDB
- `npm run bootstrap` — `install` → `build` → `setup`

Backend server (`apps/server` — NestJS/Prisma/Supabase/Clerk; needs `apps/server/.env`, copy from `.env.example`):
- `npm run dev -w apps/server` — run the API in watch mode (listens on :8080); `npm run start -w apps/server` runs the built server
- `npm run prisma:migrate -w apps/server` — apply migrations, or create one after editing `schema.prisma` with `-- --name <change>`; `prisma:deploy` applies committed migrations in CI/prod; `prisma:generate` regenerates the typed client only
- Migrations are committed under `apps/server/prisma/migrations/`; the dashboard reaches the server via `VITE_API_BASE_URL` (e.g. `http://localhost:8080`)

Per-workspace (use `-w <workspace>`, e.g. `npm test -w packages/shared`):
- A single test file: `npm test -w packages/shared -- src/schema.test.ts`
- A single test by name: `npm test -w packages/shared -- -t "name fragment"`
- Build the extension `.vsix` locally: `npm run package -w apps/extension`

The extension is bundled with **esbuild** (`apps/extension/esbuild.mjs`), not tsc — `npm run build -w apps/extension` runs esbuild; `typecheck` runs tsc separately for both the node and webview tsconfigs.

## Architecture

### The contract is the center: `packages/shared` (`forward-core`)

Everything depends on this package; the apps depend on each other only through it. It is the **single source of truth** — change a shape or RTDB path here once and all surfaces follow. Key modules:

- `schema.ts` — Zod schemas + TS types mirroring the RTDB JSON tree, **plus `paths`** (the one place RTDB paths are constructed — always use it, never hand-build a path string).
- `rtdb-rest.ts` — a thin `fetch`-based RTDB REST client used by every non-browser surface (the extension and the MCP server). It speaks the full contract (create/update/delete elements, document them, edit the infra graph, manage members) and is the one writer, so both surfaces stay in sync.
- `rtdb.ts` — `normalizeList`: RTDB has no real arrays; a push-keyed object and a literal array can both represent the same list, so **always normalize lists on read**.
- `timeline.ts` — pure helpers that flatten per-element `version_timeline` histories into one chronological event stream, lay it out as git-graph lanes, and collapse it into a catch-up digest (to-integrate / to-modify / to-remove since a baseline). Shared by both canvases.
- `infra-flow.ts` — the infrastructure graph + narrated flows logic.

### Four intentionally-separate data layers

1. **Design** — `DesignElement`s a designer draws (frame, rectangle, text, component, instance) with absolute geometry and `parentId` hierarchy. The primary artefact; exists on its own.
2. **API binding** — an *optional* `apiBinding` a backend dev attaches to a design element from VS Code. Most elements never get one; an endpoint is never a first-class canvas object. Docs-first and framework-agnostic (`title` + Markdown `description` carry the meaning; `method`/`endpoint`/`parameters` are optional HTTP hints).
3. **Infrastructure** — an *optional*, project-scoped graph of nodes + edges (and narrated flows over them), rendered as a separate overlay. Not attached to any design element.
4. **Tasks** — an *optional*, project-scoped tracker of work items (`Task`, under the `tasks/$projectId` subtree). Like the infra graph it stands apart from the design elements, but each task optionally *links* into the other layers (`elementId` / `flowId` / `endpointId`) so work tracks against what it's about. Links are soft references resolved on read, not enforced foreign keys.

A "project id" is a **namespace within the RTDB tree** (e.g. `project_xyz`), **not** a GCP project id. The canvas's `VITE_CANVAS_PROJECT_ID` and the extension's `forward.projectId` must match for the two sides to share elements.

### The surfaces (`apps/*`)

- **`apps/canvas`** (`forward-canvas`) — vanilla-TS Figma-lite editor, consumed **only as an embedded library** (no standalone app). It exports `mountCanvas` + `ServerSource` via `forward-canvas/embed` (see `src/embed.ts`); the dashboard's `CanvasPage` mounts it into a Shadow DOM with a Clerk-token-backed `ServerSource`. The single data source is `ServerSource` (the backend REST API via `forward-core/api`); the `CanvasSource` interface lives in `src/source.ts`. Styles are injected from `src/canvas.css` (`?inline`). Renders timeline/infra diagrams via `mermaid`.
- **`apps/extension`** (`forward-vscode`) — VS Code extension. Reads via **ETag-conditional polling** over the RTDB REST API (`fetchElementsConditional` etc.) and writes via `rtdb-rest`. It is a trusted admin client (authenticates with a privileged token / DB secret that bypasses the rules), so it needs no membership roster entry. Contributes the `forward.*` commands and `forward.*` settings.
- **`apps/mcp`** (`forward-mcp`) — Model Context Protocol server giving any AI agent full parity with the canvas/extension. The server holds the Firebase credentials; the agent only sees scoped tools. `match.ts` (fuzzy feature→element matching) and `anchor.ts` (deterministic `@adc <id>` source markers) power element resolution. Env: `ADC_FIREBASE_DATABASE_URL`, `ADC_PROJECT_ID`, `ADC_AUTH_TOKEN`. All writes go through `forward-core`, so they appear live on the canvases and in version history.
- **`apps/dashboard`** (`forward-dashboard`) — React SPA (Vite + Clerk) for orgs/projects/tasks/docs/members, and the host that embeds the canvas.

### Access control

The locked rules (`apps/canvas/firebase.rules.json`) enforce a **per-project membership ACL**: every project subtree (`design_elements`, `version_timeline`, `infra_nodes`, `infra_edges`, `infra_flows`) is readable/writable only by uids in that project's `project_members` roster. The first authenticated user to open a fresh project claims it as `owner`; others are locked out until an existing member adds their uid (no open self-join). The trust boundary is the database (one team per DB); the roster adds isolation *between projects within* a DB.

## Conventions

- ESM throughout (`"type": "module"`); strict TS with `noUncheckedIndexedAccess`.
- When adding/changing any RTDB-backed data, do it in `packages/shared` first (schema + `paths` + the rest client), then consume from the apps — don't duplicate path strings or shapes in an app.
- Local config (Firebase URLs, tokens, `.env.local`, `.vscode/settings.json`) is read from local settings/env and is **never committed**.

## Publishing

Pushing a `v*` tag triggers `.github/workflows/release.yml` to build, test, package the `.vsix`, and publish to the VS Code Marketplace + Open VSX (each skipped if its `VSCE_PAT`/`OVSX_PAT` secret is absent). Bump via `npm version patch -w apps/extension && git push --follow-tags`.
