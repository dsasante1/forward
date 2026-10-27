# Contributing to Forward

Thanks for helping. Bug reports, docs fixes, new agent tools and canvas improvements are all
welcome.

## Set up

```bash
git clone https://github.com/dsasante1/forward && cd forward
npm install
npm run build        # packages/shared builds before the apps that import it
npm test
npm run typecheck
```

Node 22.12 or newer is required to develop (`.nvmrc` pins 22); the published CLI needs Node 22+. There is no server, database or account to set
up. Try your build against any repository:

```bash
cd /path/to/some/repo
node /path/to/forward/apps/mcp/dist/cli.js init
node /path/to/forward/apps/mcp/dist/cli.js serve
```

## Where things live

- **`packages/shared`** (`forward-core`) is the contract. Every data shape is a Zod schema here.
  Change a data layer here first, then the REST client, the store and router in `src/repo/`, and
  the consuming apps. Never duplicate a shape in an app.
- **`apps/mcp`** holds the agent tools (`src/tools.ts`), the MCP stdio entry (`src/server.ts`) and
  the `forward` CLI (`src/cli.ts`, `src/cli/`). A new capability is registered once in `tools.ts`
  and is then available over MCP and from the CLI.
- **`apps/canvas`** is the editor. `host/` is the standalone page the CLI serves and exports.
- **`apps/extension`** is the VS Code extension; **`apps/docs-ci`** is the bring-your-own-AI CI step.

`CLAUDE.md` has a longer architecture tour, and it is what AI coding agents read in this repo.

## Rules of thumb

- Backend behaviour lives in `packages/shared/src/repo/store.ts`. If you change a semantic, such as
  a cascade, a stamped field or a validation rule, add a test to `src/repo/repo.test.ts`.
- Keep the `.forward/` format stable. A breaking change to the file layout needs a bump of
  `FORMAT_VERSION` and a migration path.
- ESM throughout, strict TypeScript with `noUncheckedIndexedAccess`.
- Tests use Vitest. Add or update tests with every behaviour change.
- Never commit local config or secrets: `.env*`, tokens, `.vscode/settings.json`.

## Pull requests

1. Fork, branch from `master`, and keep the PR focused on one change.
2. Run `npm run build && npm run typecheck && npm test` before pushing. CI runs the same.
3. Describe what changed and why, and how you verified it.

Behaviour a user would notice gets a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

New here? Issues labelled
[`good first issue`](https://github.com/dsasante1/forward/labels/good%20first%20issue) are small
and self-contained. Comment on one before starting so work isn't duplicated. For larger changes,
open an issue or discussion first to agree on the approach.

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

## Governance

Forward is maintained by [@dsasante1](https://github.com/dsasante1), who reviews and merges pull
requests and cuts releases ([docs/releasing.md](docs/releasing.md)). Decisions are made in the
open, in issues and pull requests. When there is disagreement, the maintainer decides and writes
down why.

Contributors who make sustained, high-quality contributions and reviews may be invited to become
maintainers. New maintainers are added to `.github/CODEOWNERS` and to this section.
