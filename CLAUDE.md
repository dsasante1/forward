# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Forward is a developer-first tool. Designers draw UI on an independent visual canvas; backend developers (from VS Code or an AI agent) annotate those design elements with API, infrastructure, data-model and UML documentation, plus a historical (timeline) view of how development has changed over time — keeping frontend and backend in sync. Teams also track tasks against the design.

Forward is open source (Apache-2.0) and **git-native**: a project is plain JSON in `.forward/` inside the team's own repository (one file per record; see `packages/shared/src/repo/layout.ts`). There is no central server, database, account or token. `forward-core/repo` serves the one REST contract, `forward-core/api`, from those files: in-process for the MCP server, CLI, extension and docs-ci (via `ApiConfig.transport`), and over a local HTTP server (`forward serve`) for the canvas. Git is the sync, the history (`git log` → project timeline) and the access control.

The product is **AI-agent first**: every capability is an MCP tool registered once in `apps/mcp/src/tools.ts`, served over stdio (`forward-mcp`) and callable from the shell (`forward <tool>`), so Claude, Codex, Cursor or a script all get the same behaviour.

## Commands

Run from the repo root (npm workspaces; Node >= 22.12 to develop, `.nvmrc` pins 22; the published `forward-mcp` needs Node >= 22; `forward-docs` still runs on Node >= 20).

- `npm install` — install all workspaces
- `npm run build` — build every workspace (`packages/shared` must build before the apps that import it; `apps/canvas` before `apps/mcp`, which copies the canvas UI; `apps/site` last, because its `/demo` runs the built CLI)
- `npm test` — run all Vitest suites across workspaces
- `npm run typecheck` — typecheck all workspaces
- `npm run bootstrap` — `install` → `build`

The `forward` CLI (after `npm run build`, `node apps/mcp/dist/cli.js` is the binary):
- `forward init` — create `.forward/` plus AGENTS.md/CLAUDE.md, `.mcp.json`, `.cursor/mcp.json` and `.github/workflows/forward.yml` in a repo
- `forward serve` — the canvas editor on `.forward/` (127.0.0.1:4747, per-session token, Host check)
- `forward validate` / `forward diff <ref>` / `forward export --out _site` — CI check, PR catch-up digest, static GitHub Pages site
- `forward tools`, `forward <tool> --arg v`, `forward call <tool> '<json>'`, `forward mcp` — the agent tools from the shell
- `npm run pack -w apps/mcp` — the self-contained npm package (`apps/mcp/pkg`, bundles forward-core + the canvas UI)
- The standalone canvas host is `apps/canvas/host/` (built by `npm run build -w apps/canvas` into `dist-host/`; `npm run dev:host -w apps/canvas` for Vite dev)

Per-workspace (use `-w <workspace>`, e.g. `npm test -w packages/shared`):
- A single test file: `npm test -w packages/shared -- src/schema.test.ts`
- A single test by name: `npm test -w packages/shared -- -t "name fragment"`
- Build the extension `.vsix` locally: `npm run package -w apps/extension`

The extension is bundled with **esbuild** (`apps/extension/esbuild.mjs`), not tsc — `npm run build -w apps/extension` runs esbuild; `typecheck` runs tsc separately for both the node and webview tsconfigs.

## Architecture

### The contract is the center: `packages/shared` (`forward-core`)

Everything depends on this package; the apps depend on each other only through it. It is the **single source of truth** for every data shape — change it here once and all surfaces follow. Key modules:

- `schema.ts` — Zod schemas + TS types for all seven data layers. The same schemas validate every `.forward/` file on read and write.
- `api-rest.ts` — the **client every surface uses**, exported as `forward-core/api`. Every function takes an `ApiConfig` (`projectId`, plus either an in-process `transport` or a `baseUrl` + session `token` for `forward serve`), never touches storage directly, and lets the backend own identity + timestamps.
- `repo/` — the backend, exported as `forward-core/repo` (node-only; never import it from browser code except as types). `RepoStore` owns the semantics over `.forward/` files (binding owned by bind/unbind, delete cascades, stamped `updatedAt`, append-only history files); `createRepoRouter` maps the REST routes onto it; `repoConfig()`/`findRepoRoot()` build an `ApiConfig`; `git.ts` derives the project timeline and contributor roster from git and materializes `.forward/` at a ref; `validate.ts` is the CI check; `bundle.ts` exports a whole project and diffs two states into the PR digest. Behaviour is pinned by `repo/repo.test.ts`.
- `api-diff.ts` — the "git-diff for API docs": diffs two `apiBinding`s (title change + line-level Markdown diff) into the structured `VersionDiff` the History timeline expands.
- `timeline.ts` — pure helpers that flatten per-element `version_timeline` histories into one chronological event stream, lay it out as git-graph lanes, and collapse it into a catch-up digest (to-integrate / to-modify / to-remove since a baseline).
- `infra-flow.ts` — the infrastructure graph + narrated flows logic; serializes flows to a Mermaid `sequenceDiagram` and the graph to a component diagram.
- `entity.ts` — the ER/data-model layer; serializes entities + crow's-foot relations to a Mermaid `erDiagram`.
- `tasks.ts` — task-tracker helpers (keys, activity, ordering).
- `gantt.ts` — the task timeline: the one rule for a task's span (`taskSpan`: `startDate` else the created day → ISO `dueDate` else one day; milestones are points), dependency-cycle detection, the pixel layout the canvas Timeline draws (`buildGanttModel`), and the Mermaid `gantt` serializer used by `get_task_timeline` and the PR digest.

### Seven intentionally-separate data layers

The **design** layer is primary and stands alone; every other layer is optional and either *attaches to* a design element or *links* to one by id (soft references resolved on read, never enforced foreign keys; `forward validate` reports dangling ones as warnings).

1. **Design** — `DesignElement`s a designer draws (frame, rectangle, ellipse, text, component, instance) with absolute geometry and `parentId` hierarchy. The primary artefact; exists on its own.
2. **API binding** — an *optional* `apiBinding` (`{ title, description }`) a backend dev attaches to a design element. Most elements never get one; an endpoint is never a first-class canvas object. Docs-first and framework-agnostic (Markdown `description` carries the meaning).
3. **Infrastructure** — an *optional*, project-scoped graph of `InfraNode`s + `InfraEdge`s, rendered as a separate overlay. Not attached to any design element.
4. **Flows** — narrated `InfraFlow`s: ordered hops over the infra nodes; a hop may tie to an endpoint (`endpointId`). Render as numbered arrows and serialize to a Mermaid sequence diagram.
5. **Entities (ER/UML)** — an *optional*, project-scoped data model of `Entity` tables + `EntityRelation`s (crow's-foot cardinality). Its own graph; serializes to a Mermaid `erDiagram`.
6. **Tasks** — an *optional*, project-scoped tracker (`Task`: status/priority/type, assignees, `startDate`/`dueDate`, `dependsOn`, activity feed). Stands apart but each task optionally *links* into the other layers (`elementId` / `flowId` / `endpointId`). Shown as a list or a timeline (Gantt).
7. **Checkpoints** — *optional*, named, restorable snapshots of the whole canvas (design + infra), each with a note and per-layer change counts.

On top sit the **timelines**: the per-element append-only `version_timeline` (API-doc history, one file per entry under `.forward/history/`) and a unified project event feed (`ProjectTimelineEvent`, domain-tagged design/api/infra/flow/agent, built from `git log` plus uncommitted changes), driving the History git-graph, doc diffs and catch-up digest.

A "project id" is the `id` in `.forward/forward.json`.

### The surfaces (`apps/*`)

- **`apps/canvas`** (`forward-canvas`) — vanilla-TS design editor. Exports `mountCanvas`, `ServerSource` and `StaticSource` via `forward-canvas/embed` (`src/embed.ts`, types in `embed.d.ts`). Hosts: the standalone page in `host/` that the CLI ships (`forward serve` → `ServerSource` against the local server; `forward export` → read-only `StaticSource` over a project bundle, for GitHub Pages) and the VS Code extension webview (a postMessage-bridged `CanvasSource`). The `CanvasSource` interface lives in `src/source.ts`; styles are injected from `src/canvas.css` (`?inline`); diagrams render via `mermaid`. The Member view is a read-only list of git contributors.
- **`apps/extension`** (`forward-vscode`) — VS Code extension. Uses the workspace's `.forward/` in-process (found via `findRepoRoot`); no settings, sign-in or project picker. `forward.initRepo` creates `.forward/`; `forward.setupMcp` copies the `claude mcp add` line. Contributes the `forward.*` commands (connect endpoint, insert anchor, edit infra/flows/agents, file/schedule/update tasks, task timeline, history, catch-up, validate). `forward validate` runs into the Problems panel on every `.forward/` change. The canvas panel refreshes on `.forward/` and git-HEAD file events (`src/refresher.ts`) plus a 15 s backstop, never a fast poll: the project timeline runs git synchronously in the extension host.
- **`apps/mcp`** (`forward-mcp`) — the agent surface. `src/tools.ts` registers ~40 scoped tools on one `McpServer` (full parity with canvas/extension, plus `project_info`, `validate_project`, `get_changes_since_ref`); `src/server.ts` serves them over stdio; `src/cli.ts` is the `forward` CLI, which calls the same tools through an in-memory MCP client (`src/cli/call.ts`) and adds `init`/`serve`/`validate`/`diff`/`export`/`capture`/`agents`/`github` (`src/cli/`). `capture.ts` (browser collector; engine choice: the project's Playwright, an installed Chromium browser driven by `browser/` over the DevTools protocol, or the `forward-capture` companion in `companion/`) and `import-anchors.ts` back `import_design_from_code`, which turns a running frontend into design drafts via forward-core's `design-import.ts`. The project is the nearest `.forward/` above the cwd (or `FORWARD_REPO`); `FORWARD_AGENT` tags the author. `match.ts` (fuzzy feature→element matching) and `anchor.ts` (deterministic `@adc <id>` source markers) power element resolution. Published to npm as one esbuild bundle by `scripts/pack.mjs` (forward-core is not published).
- **`apps/docs-ci`** (`forward-docs-ci`) — bring-your-own-AI CI step: an agent writes `forward-docs.json`, `forward-docs apply` validates it and writes it into `.forward/` (git is the undo), and the workflow template commits the result back to the PR. `dist/action.mjs` is committed — rebuild it with `npm run build -w apps/docs-ci` after changing `src/`.
- **`apps/site`** (`forward-site`, private) — the public website: landing page (`/`), docs (`/docs/`) and a live read-only canvas (`/demo/`). React + Vite, two pages prerendered to static HTML (`scripts/prerender.mjs`) and hydrated. `demo/build-demo.mjs` seeds a fictional project through the real CLI tools in a throwaway repo (isolated HOME and git config, fictional authors) and runs `forward export` into `dist/demo`. Deployed by Vercel's Git integration from the root `vercel.json` (master → production, PRs → previews). `src/site.test.ts` checks that every command, tool and flag the pages name exists in the built CLI, so run the build before its tests.

### Access control

Access is whatever the git host grants: who can push to the repository can change the project. The roster (`GET /members`, `list_members`) is derived from git contributors and is read-only. `forward serve` has no accounts, so it binds to loopback, requires a random per-session token on every API call, and rejects unexpected `Host` headers.

## Conventions

- ESM throughout (`"type": "module"`); strict TS with `noUncheckedIndexedAccess`.
- **Change any data layer in `packages/shared` first** (the schema), then propagate to the `api-rest` client, the store/router in `packages/shared/src/repo/` (with a test in `repo.test.ts`), and the consuming apps. Never duplicate a shape in an app. Keep the `.forward/` file format stable; a breaking layout change bumps `FORMAT_VERSION`.
- The backend owns identity + timestamps: an `author` passed by a client is ignored — git `user.name` (`FORWARD_AUTHOR` overrides, `FORWARD_AGENT` appends `via <agent>`) decides who wrote it.
- Local config (`.env`/`.env.local`, `.vscode/settings.json`) is **never committed**.

## Publishing

Releases are tags; [docs/releasing.md](docs/releasing.md) has the details and one-time setup.
- `mcp-v<version>` → `.github/workflows/release-mcp.yml`: verifies (build, typecheck, tests, `npm run pack -w apps/mcp`, `npm run smoke:package -w apps/mcp`), then publishes `apps/mcp/pkg-capture` as `forward-capture` and `apps/mcp/pkg` as `forward-mcp` (same version, companion first) via **trusted publishing** (OIDC, no `NPM_TOKEN`, provenance automatic), then a GitHub Release. The tag must equal `apps/mcp/package.json`'s version. Each package's very first publish is manual (`npm publish ./apps/mcp/pkg[-capture] --access public`) because npm's trusted-publisher setting needs the package to exist.
- `forward-mcp` has **no dependencies**; `forward-capture` (`src/companion/`) has exactly one, `playwright-core`, pinned exactly via the devDependency in `apps/mcp/package.json`. `forward capture` runs the companion only when the project has no Playwright and no Chromium-based browser is installed, and only at its own exact version.
- `v<version>` → `.github/workflows/release.yml`: the VS Code extension to the Marketplace + Open VSX (skipped when `VSCE_PAT`/`OVSX_PAT` is absent).
- The CLI reads its version from `package.json` (`apps/mcp/src/version.ts`), so `forward --version` always matches what npm installed.

The root `action.yml` is the GitHub Action teams use (validate + PR digest comment + Pages export); `.github/workflows/ci.yml` dogfoods it and runs the package smoke test.
