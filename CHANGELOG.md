# Changelog

Notable changes to Forward. Each component versions independently and releases from its own
tag (see [docs/releasing.md](docs/releasing.md)): `forward-mcp` from `mcp-v*`, the VS Code
extension from `v*`, the docs-ci Action from `docs-ci-v*`. The Forward GitHub Action is
released with `forward-mcp` and shares its tag.

## forward-mcp 0.5.0 — 2026-10-31

### Breaking

- **`list_members` and `GET /members` return `{ members, shallow }`** instead of an array, and
  members no longer have `role` or `imageUrl`. `role` was only a label: whoever ran the command
  was `owner`, so every machine gave a different answer. Access is still your git host's.
- **A new or changed task `dueDate` must be an ISO date.** Tasks saved before this rule keep
  their label until it changes, and `forward validate` warns about them.
- **`strict` fails on new warnings** (off by default): non-ISO due dates, dependency cycles and,
  with full git history, assignees who haven't committed to `.forward/`.

### Added

- **Task timeline.** The canvas Tasks view has a Gantt timeline, also shown on the exported
  site. Tasks take an optional `startDate`, `get_task_timeline` returns the schedule as a Mermaid
  `gantt` chart with its warnings, and the PR digest lists tasks whose dates moved.
- `forward validate` warns about task assignees who aren't on the contributor roster. It stays
  quiet with no git history or in a shallow clone, where the roster is incomplete.
- `list_members` marks automation accounts with `bot` and reports a shallow clone with `shallow`.

### Changed

- The roster lists only people who have committed to `.forward/`; the current user no longer
  gets a row of their own. An agent session no longer shows up as a separate person.
- The roster and the project timeline apply `.mailmap`.
- A task's `reporter` and activity `actor` are stamped by the backend from your git identity
  (`FORWARD_AUTHOR` overrides, `FORWARD_AGENT` appends `via <agent>`), so the canvas no longer
  writes `canvas` and agents no longer write `claude`. Existing tasks keep their attribution.
- The canvas's Member tool is now **People**, and it refreshes while open.

### Fixed

- A commit with a malformed author name or date no longer breaks the contributor list.
- `forward serve` and exported sites no longer log a favicon 404.

### Security

- zod 4.6.7 (GHSA-mrhx-c7xc-m3w5).

## VS Code extension 0.5.0 — 2026-10-31

### Added

- **Create Task** asks for type, priority, start and due dates and dependencies; a milestone
  takes one date. **Update Task** changes one field and warns before saving a dependency cycle.
- **Show Task Timeline** opens the canvas on the Gantt view.
- **Validate Project** runs `forward validate` into the Problems panel, and again on every
  `.forward/` change.

### Changed

- The canvas refreshes on `.forward/` and git file events, plus a 15 s backstop, instead of
  re-reading everything every second. There is one canvas panel per window.
- Includes the forward-mcp 0.5.0 roster, task identity and People changes above.

### Fixed

- A failed read shows the error instead of "No tasks yet".
- Tasks are credited to your git identity rather than `extension`.

## forward-mcp 0.4.0 — 2026-10-28

### Added

- **Designs from frontend code.** `forward capture <url> [route ...]` (the agent tool
  `import_design_from_code`) renders the running app and turns what the browser painted into
  canvas drafts: a frame per route, boxes, text, and components with instances from React dev
  builds. Re-running updates drafts in place and keeps their API docs; edited drafts are never
  overwritten; **Adopt draft** turns a draft into an ordinary element; deleted drafts are
  remembered in `.forward/dismissed/` (`--restore` brings them back); `--prune` removes stale
  ones; `--anchors` adds `// @adc <id>` markers to the source. API docs never move on an
  ambiguous match. `forward capture --script` and `--from` capture from any browser's DevTools.
- **Live capture with the browser you already have**: Chrome, Edge, Brave, Chromium, Vivaldi or
  Opera, headless, with a temporary profile, controlled over a pipe. `--browser` picks one,
  `--browsers` lists them, `FORWARD_BROWSER` sets the default. The project's own Playwright is
  used first when it declares one.
- **`forward-capture`**, a companion package released at the same version. With no Playwright
  and no Chromium browser, `forward capture` runs it through `npx`; it brings Playwright and
  downloads Playwright's headless Chromium once (about 100 MB). `FORWARD_NO_DOWNLOAD=1` forbids
  both downloads. `forward-mcp` itself still has no dependencies.

## forward-mcp 0.3.0 — 2026-10-27

### Changed

- **Requires Node 22 or newer** (was 20; Node 20 reached end of life in April 2026). The bundle
  now targets Node 22. `forward-docs` (docs-ci) still runs on Node 20.
- The canvas UI is built with Vite 8 and bundles mermaid 11.17.

### Security

- Bundled dependencies updated: dompurify 3.4.17 (cross-site scripting in sanitized mermaid
  diagrams), `@modelcontextprotocol/sdk` 1.32 and its HTTP stack (express, body-parser,
  proxy-addr, qs, hono).

## Unreleased

The first open-source release. Forward is now git-native: there is no hosted server.

### Added

- Apache-2.0 license, with `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and
  issue and pull request templates.
- Projects live in `.forward/` inside your repository, one JSON file per record. `forward-core/repo`
  serves the REST contract from those files, and git is the sync, the history and the access control.
- The `forward` CLI: `init`, `serve`, `validate`, `diff`, `export`, `agents`, plus every agent tool
  from the shell (`forward <tool>`, `forward call`).
- The Forward GitHub Action (root `action.yml`): validates `.forward/` on pull requests, posts a
  catch-up digest comment, and exports a read-only canvas to GitHub Pages.
- `forward-mcp` packaged for npm as one self-contained bundle, published with trusted publishing.
- Every shipped artifact includes `THIRD_PARTY_NOTICES.txt` for its bundled dependencies.

### Changed

- **docs-ci `docs-ci-v2`** (breaking): writes into `.forward/`. The `api-base-url`, `project-id`
  and `api-token` inputs are gone. `docs-ci-v1` remains the retired hosted-server API.
- The VS Code extension (from 0.4.0) works on the workspace's `.forward/` in-process, with no
  sign-in, settings or project picker. Its license is now Apache-2.0, matching the repository.
- `forward init` pins the Action in the generated workflow to the CLI's own `mcp-v<version>`
  release tag and runs that version from npm.

### Removed

- The hosted server, dashboard and admin apps, their deployment workflows and the Terraform
  infrastructure.

## Earlier versions

Releases before the open-source release (VS Code extension 0.1.0 – 0.4.0, docs-ci `docs-ci-v1`)
were made while the repository was private and targeted the retired hosted server.
