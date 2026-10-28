# Forward

Keep **UI design and backend documentation in sync**, inside your repository.

Designers draw UI on a visual canvas. Backend developers, and the AI agents working with them,
attach API docs, infrastructure, data-model and flow documentation to those design elements. A
history timeline and a catch-up digest show frontend developers exactly which endpoints to
integrate, change or remove.

- **Lives in git.** The whole project is plain JSON in `.forward/`, one file per record. It is
  versioned, reviewed and merged with the code it describes. No server and no account are needed.
- **AI-agent first.** Claude Code, Codex, Cursor, Copilot or any MCP client gets 39 tools with full
  parity with the canvas. Agents without MCP use the same tools through the `forward` CLI.
- **GitHub native.** One workflow validates `.forward/` on pull requests, posts a catch-up digest
  as a PR comment, and publishes a read-only canvas to GitHub Pages.
- **Open source** under the [Apache 2.0 license](LICENSE).

## Quick start

Run this in the root of your repository. Node 22 or newer is required.

```bash
npx -y -p forward-mcp forward init     # creates .forward/, agent configs and the GitHub workflow
npx -y -p forward-mcp forward serve    # opens the canvas editor on .forward/ at http://127.0.0.1:4747
git add .forward AGENTS.md CLAUDE.md .mcp.json .cursor .github && git commit -m "Add Forward"
```

`forward serve` writes straight to `.forward/`. An agent editing through MCP at the same time
shows up on the canvas within a couple of seconds, and the History view reads your git log.

> **Not on npm yet?** Until `forward-mcp` is published, build from source and use
> `node <path-to-forward>/apps/mcp/dist/cli.js` wherever this README says `forward`:
> `git clone https://github.com/dsasante1/forward && cd forward && npm install && npm run build`.

## AI agents

`forward init` (or `forward agents` later) writes the agent wiring into your repository:

| File | For |
|---|---|
| `AGENTS.md` | Instructions every agent reads: when and how to document endpoints, infra and schema |
| `CLAUDE.md` | Imports `AGENTS.md` for Claude Code |
| `.mcp.json` | Registers the `forward` MCP server for Claude Code |
| `.cursor/mcp.json` | Registers it for Cursor |
| `.vscode/mcp.json` | Registers it for VS Code / Copilot (`forward agents --vscode`) |

Codex reads `AGENTS.md`. Register the server in `~/.codex/config.toml`:

```toml
[mcp_servers.forward]
command = "npx"
args = ["-y", "forward-mcp"]
env = { FORWARD_AGENT = "codex" }
```

Any other MCP client runs `npx -y forward-mcp` over stdio from the repository root. No
configuration is needed: the server finds the nearest `.forward/` and works on those files.

**Without MCP**, the CLI calls the very same tool code in-process:

```bash
forward tools                                   # list all 39 tools
forward tools write_documentation               # one tool's arguments
forward find_element --query "login button"
forward write_documentation --element-id el_123 --title "POST /login" --description "Body: email, password"
forward call write_infra_node '{"kind":"cache","label":"Redis"}'
forward diff origin/main                        # what this branch changed, as Markdown
```

Good first calls for an agent are `project_info`, `find_element`, `write_documentation`,
`validate_project` and `get_changes_since_ref`. Writes are stamped with your git `user.name`, plus
`via <agent>` when `FORWARD_AGENT` is set.

## Designs from frontend code

Ideally the frontend is built from the design. When a screen was built first, Forward can draw it
for you: it renders the running app, reads back what the browser actually painted (position, size,
colours, borders, corners, fonts, text, stacking) and turns it into canvas elements: one frame per
route, a box for everything that paints, text for every run of text. Wrappers that paint nothing are
dropped, so the layer tree stays readable. React dev builds also report which component rendered
each node, so repeated components become a component plus instances.

```bash
npm i -D playwright && npx playwright install chromium   # once, in your project
forward capture http://localhost:5173 / /login /settings --dry-run
forward capture http://localhost:5173 / /login /settings
forward capture http://localhost:5173 /account --auth state.json --viewport 390x844
```

No Playwright? `forward capture --script` prints a snippet to paste into the browser's DevTools
console. It downloads `forward-snapshot.json`, which `forward capture --from forward-snapshot.json`
imports. Agents call the same thing as `import_design_from_code`.

Generated elements are **drafts**, marked "from code" on the canvas:

- Re-running a capture updates drafts in place, and API docs attached to a draft are kept. An
  element keeps its identity by its `data-testid`, `id`, the JSX line that rendered it (React dev
  builds) or its `aria-label`. Failing those, by its position under the nearest element that has
  one. When the page around a draft changes (a banner inserted above, say), drafts are re-matched by
  type, name or text, size and what they contain, as long as the match is unambiguous. API docs
  never move on a guess: if a documented draft can't be matched for certain, it stays where it was
  (stale, docs intact) and the capture reports it. Test ids on repeated or generic elements make
  identity certain.
- A draft someone has edited (moved, restyled, renamed) is never overwritten. The import reports
  it as a conflict.
- **Adopt draft** (inspector or right-click menu) turns a draft into an ordinary design element
  that imports never touch again.
- Deleting a draft remembers it in `.forward/dismissed/`, so the next capture doesn't bring it
  back. `--restore` brings deleted drafts back.
- Drafts the code no longer renders are reported as stale. `--prune` removes them, but never one
  that is documented, edited, adopted, or holds something that stays. Pruning also forgets deleted
  drafts the code no longer renders.
- `--anchors` adds `// @adc <id>` markers above each component's declaration in your JS/TS source,
  so `resolve_anchors` links code to design. It edits source files, so it is off by default; every
  capture says how many anchors it would add.
- Adopting a draft isn't listed as a design change in the PR digest. The digest reports it on its
  own "Adopted from code" line instead.
- A capture records what the page shows, so run it against development or seed data, not real
  customer data. Password fields are always masked.

## GitHub

`forward init` adds [`.github/workflows/forward.yml`](apps/mcp/src/cli/scaffold.ts), which uses
this repository's [composite action](action.yml):

- **On pull requests** it runs `forward validate`, annotating schema errors inline. It then posts
  one comment, updated on every push, listing new, changed and removed endpoints with doc diffs and
  a per-layer summary of everything else.
- **On the default branch** it builds a static, read-only canvas with `forward export` and deploys
  it to GitHub Pages. Turn Pages on with *Source: GitHub Actions*.

Teams that want an AI to write the docs on every pull request can add the bring-your-own-AI
pipeline in [apps/docs-ci](apps/docs-ci). Its repo-mode template commits the generated `.forward/`
changes back to the PR branch.

## How it works

```
  designers              backend devs                 AI agents                 GitHub
      │                       │                           │                        │
 [ canvas ]        [ VS Code extension ]        [ MCP server · CLI ]      [ Action · Pages ]
      │                       │                           │                        │
      └───────────────────────┴──────── forward-core/api ─┴────────────────────────┘
                                             │
                               .forward/ files in your git repo
```

Every surface speaks one REST contract, `forward-core/api`. A router in `forward-core/repo`
serves that contract from the files in `.forward/`: in-process for the MCP server, CLI, extension
and CI, and over a local HTTP server that `forward serve` runs for the canvas. There is no central
server, database or account. Git is the sync, the history and the access control.

### The `.forward/` directory

| Path | Holds |
|---|---|
| `forward.json` | Project manifest: id, name, format version |
| `design/<id>.json` | Design elements, each with its optional `apiBinding` docs |
| `history/<elementId>/<ts>-<n>.json` | Append-only API-doc history, one file per version |
| `infra/nodes`, `infra/edges`, `infra/flows` | Infrastructure graph and narrated flows |
| `data/entities`, `data/relations` | ER data model |
| `agents/agents`, `agents/servers` | Agents and the MCP servers they call |
| `tasks/<id>.json` | Task tracker |
| `checkpoints/<id>.json` | Named, restorable snapshots of design and infra |
| `dismissed/<id>.json` | Code drafts someone deleted, so capture doesn't recreate them |

One file per record keeps merges clean and PR diffs readable. History entries are separate files,
so two branches that both document endpoints merge without conflicts. The project activity feed is
built from `git log`, so commit messages show up in the History timeline. `forward validate` checks
schemas, ids and cross-layer links.

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

npm workspaces (Node >= 22.12 to develop; `.nvmrc` pins 22).

| Path | Package | What it is |
|---|---|---|
| [packages/shared](packages/shared) | `forward-core` | The contract: Zod schemas + types, timeline/diff/infra/entity helpers, the `api-rest` client (`forward-core/api`) and the repo-mode store, router and git helpers (`forward-core/repo`) |
| [apps/mcp](apps/mcp) | `forward-mcp` | The agent surface: the MCP server (`forward-mcp`) and the `forward` CLI (init, serve, validate, diff, export, capture, agents, every tool) |
| [apps/canvas](apps/canvas) | `forward-canvas` | The design editor, shipped standalone with the CLI (`host/`) and embedded in the VS Code extension |
| [apps/extension](apps/extension) | `forward-vscode` | VS Code extension. Works on the workspace's `.forward/` automatically |
| [apps/docs-ci](apps/docs-ci) | `forward-docs-ci` | Bring-your-own-AI CI step that applies an agent-written plan to a project |

## Development

```bash
npm install && npm run build    # build packages/shared first, then every app
npm test                        # all Vitest suites
npm run typecheck
npm run dev:host -w apps/canvas # hack on the standalone canvas host with Vite
node apps/mcp/dist/cli.js serve # run your local build of the CLI against a repo with .forward/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, conventions and governance, and
[CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Publishing

Releases are tags. `mcp-v*` publishes `forward-mcp` to npm with trusted publishing, so no npm token
is stored anywhere. `v*` publishes the VS Code extension. Both re-run the full verification first,
and `forward-mcp` is smoke-tested as the installed tarball. See [docs/releasing.md](docs/releasing.md),
including the one-time manual first publish.

```bash
npm version 0.3.0 -w apps/mcp --no-git-tag-version   # land it through a PR, then:
git tag mcp-v0.3.0 && git push origin mcp-v0.3.0
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
