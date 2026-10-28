# Changelog

Notable changes to Forward. Each component versions independently and releases from its own
tag (see [docs/releasing.md](docs/releasing.md)): `forward-mcp` from `mcp-v*`, the VS Code
extension from `v*`, the docs-ci Action from `docs-ci-v*`. The Forward GitHub Action is
released with `forward-mcp` and shares its tag.

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
