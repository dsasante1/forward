# Forward

A developer-first tool that keeps design and backend documentation in sync. **Designers draw UI on an independent
visual canvas; backend developers then annotate those design elements — straight from VS Code —
with API, infrastructure, and UML documentation, alongside a historical view of how the work
has changed over time** — keeping frontend and backend in sync. Organizations and users sign
up, manage members, and set up tasks for developers, so the design, its documentation, and the
work tracked against it all live in one place.

The product is moving to a centrally-hosted backend ([apps/server](apps/server)) that owns
authentication, sign-up, the database, tenancy, and the realtime sync bus. The canvas,
extension, and MCP surfaces currently sync through a Firebase Realtime Database via the shared
`forward-core` contract; that single module is the swap point onto the new server.

```
[Web Canvas: designers draw UI] --> [Realtime sync bus] <-- [VS Code: backend annotates elements]
                                      (live two-way sync)
```

## Two layers, one contract

The data model separates *design* from *API metadata*:

- **Design layer** — `DesignElement`s (frames, rectangles, text, components/instances) with
  geometry, hierarchy and style. This is what the designer creates and owns.
- **API binding** — an *optional* `apiBinding` attached to a design element by the backend.
  Most elements never get one; an endpoint is never a canvas object on its own.

## Monorepo layout

This is an npm-workspaces monorepo. The shared schema is the contract between all parts —
change it there once and both apps stay in sync.

| Path | What it is |
|---|---|
| [packages/shared](packages/shared) | Zod schemas + TS types for the design/binding tree (the data contract) |
| [apps/extension](apps/extension) | VS Code extension: pick a design element → write API docs (any language/framework) onto it |
| [apps/canvas](apps/canvas) | Figma-lite design editor (draw/move/resize/nest/components) + API drawer + endpoint timeline |
| [apps/mcp](apps/mcp) | MCP server: gives **any AI agent** full parity with the canvas — author/document design elements, map the infrastructure graph, read the timeline, and manage project access (the AI-native surface) |

## Using the canvas editor

Runs offline against [apps/canvas/public/fixture.json](apps/canvas/public/fixture.json) — no Firebase needed to try it.

- **Toolbar:** Move, Frame, Rect, Text; Comp (make selection a component), Inst (place an
  instance), Del. Against a live database, a **+Member** control enrols collaborators by
  uid (see [Access control](#access-control-per-project-membership)).
- **Draw:** pick a tool and drag on the canvas. **Select** to move; drag the corner handle
  to resize. Dropping an element inside a frame nests it; edges snap to neighbours.
- **Right panel:** edit position/size/style, view the API binding the backend attached, and
  the endpoint's version history.
- **Endpoint timeline:** the **History** toggle opens the project timeline — a git-graph
  of every endpoint's *created / modified / deleted* events (one lane per endpoint, like git
  branch columns) plus a **catch-up digest** that collapses the stream since a chosen
  baseline ("last 24 h / 7 d / 30 d / all time") into the net *to integrate / to modify /
  to remove* lists a frontend dev acts on. Clicking any event selects its design element.
  The same view lives in the VS Code canvas behind its **Timeline** toolbar button.

## Using with AI tools (MCP)

[apps/mcp](apps/mcp) is the **AI-native surface**: a [Model Context
Protocol](https://modelcontextprotocol.io) server that gives any MCP-capable
agent (Claude Code, Cursor, …) **full parity with the canvas and extension** —
every data pillar is reachable, so a backend dev can just say *"document the
login endpoint I built"* or *"add a Redis cache to the architecture diagram"*
and the agent does it. The server holds the Firebase credentials; the agent only
sees the scoped tools, never the token.

| Capability | Tools |
|---|---|
| **Find the right element** | `list_design_elements`, `find_element` (fuzzy match a feature → element), `resolve_anchors` (deterministic `@adc <id>` markers in source) |
| **API documentation** | `get_documentation`, `write_documentation`, `remove_documentation` |
| **Design layer (author)** | `create_element` (frame / rectangle / text / component / instance), `update_element` (move / resize / rename / restyle / re-parent), `delete_element` (cascades to nested children) |
| **Infrastructure graph** | `list_infra` (+ a UML component diagram), `write_infra_node`, `connect_infra`, `remove_infra_node` |
| **Infrastructure flows** | `list_flows` (steps + a UML sequence diagram), `write_flow`, `add_flow_step`, `remove_flow` |
| **Endpoint timeline** | `get_history` (one element), `get_catchup_digest` (net to-integrate / modify / remove since 24h / 7d / 30d / all) |
| **Access control** | `list_members`, `add_member`, `remove_member` |

Designers normally own the design layer on the canvas, so an agent prefers
documenting existing elements over drawing new ones — `create_element` is there
for when the design is genuinely missing what you built. Writes go through the
same `forward-core` contract the extension uses, so every change shows up live on
the read-only canvases and is recorded in the version history.

Register the built server with your agent (full config, env vars and the
fuzzy-vs-deterministic linking flow are in [apps/mcp/README.md](apps/mcp/README.md)):

```bash
npm run build -w apps/mcp
claude mcp add forward \
  --env ADC_FIREBASE_DATABASE_URL=https://YOUR-db.firebaseio.com \
  --env ADC_PROJECT_ID=your-project \
  --env ADC_AUTH_TOKEN=your-token \
  -- node /absolute/path/to/apps/mcp/dist/server.js
```

## Install

The project ships as two parts that install differently:

### 1. The VS Code extension — from the Marketplace

Search **"Forward"** in the VS Code Extensions view (or on
[Open VSX](https://open-vsx.org) for Cursor / VSCodium) and click **Install**.
Then open **Settings → Forward** and set your Firebase Realtime
Database URL and `projectId` (see [apps/extension/README.md](apps/extension/README.md)).

### 2. The canvas + tooling — clone and bootstrap

Designers run the web canvas locally against their own database:

```bash
git clone https://github.com/dsasante1/forward
cd forward
npm run bootstrap        # install + build + interactive Firebase setup
npm run dev:canvas       # run the web canvas locally
```

`npm run bootstrap` chains `npm install` → `npm run build` → `npm run setup`. The
[setup script](scripts/setup.mjs) interactively writes your `apps/canvas/.env.local`
and `.vscode/settings.json`, scaffolds `firebase.json` / `.firebaserc`, and deploys
the locked security rules. Set the **same** `projectId` here as in the extension so
both sides share design elements.

> Two manual steps the setup script can't do for you: enable **Anonymous sign-in**
> in the Firebase console (so the locked rules admit your canvas), and — only if the
> extension needs to *write* under locked rules — put its `authToken` in your VS Code
> **User** settings, never in committed workspace settings.

## Getting started (development)

```bash
npm install              # installs all workspaces
npm run build            # build shared + apps
npm test                 # run all unit tests (Vitest)
npm run dev:canvas       # run the web canvas locally (offline off the fixture)
npm run setup            # (re)configure your Firebase connection
```

## Publishing the extension (maintainers)

Publishing is automated by [.github/workflows/release.yml](.github/workflows/release.yml):
pushing a `v*` tag builds, tests, packages a `.vsix`, publishes to the VS Code
Marketplace **and** Open VSX, and attaches the `.vsix` to a GitHub Release.

One-time setup: register a publisher on the
[Marketplace](https://marketplace.visualstudio.com/manage) and [Open VSX](https://open-vsx.org),
set the `publisher` field in [apps/extension/package.json](apps/extension/package.json),
and add the repo secrets `VSCE_PAT` and `OVSX_PAT` (a store is skipped if its secret
is absent). Then:

```bash
npm version patch -w apps/extension
git push --follow-tags
```

To build a `.vsix` locally without publishing: `npm run package -w apps/extension`.

## Data & privacy

Firebase config and tokens are read from local settings / env and are **never committed**
(see [.gitignore](.gitignore)). On the current Firebase path, lock the database down with the
security rules in [apps/canvas/firebase.rules.json](apps/canvas/firebase.rules.json); once a
surface is repointed at [apps/server](apps/server), auth and tenancy are enforced there
(Clerk + per-project membership + Postgres RLS).

### Access control (per-project membership)

The locked rules enforce a **per-project membership ACL** — every project subtree
(`design_elements`, `version_timeline`, `infra_nodes`, `infra_edges`, `infra_flows`) is
readable and writable only by uids listed in that project's `project_members` roster:

- **Claim on first use** — the first authenticated user to open a fresh project claims it
  as `owner` (the canvas seeds the roster automatically after anonymous sign-in).
- **Enrolling collaborators** — anyone else opening that project is locked out and sees a
  banner with their **uid**. An existing member pastes that uid into the canvas toolbar's
  **+Member** control to grant access. (Onboarding is deliberately explicit — there's no
  open self-join.)
- **The VS Code extension is a trusted admin client.** It authenticates over REST with a
  privileged token; a Firebase **DB secret bypasses the rules as admin**, so it needs no
  roster entry. If you instead give it a uid-scoped ID token, add that uid to each project's
  roster like any other member.

On the current Firebase path the trust boundary is the **database** (one team per DB); the
membership roster adds isolation *between projects* within that database. Test-mode (open) rules and the
offline fixture / mock sources have no auth and skip membership entirely.

## Status

Working end-to-end: the Figma-lite editor (offline fixture, local mock-rtdb, or a live
Firebase RTDB), the VS Code documentation bridge (ETag-conditional polling over the RTDB
REST API), the infrastructure overlay, the MCP server, and the project **endpoint
timeline** (git-graph history + catch-up digest, rendered in both the web canvas and the
VS Code viewer). The MCP server now reaches **every feature** an AI agent could want —
authoring/documenting design elements, editing the infrastructure graph, reading the
timeline, and managing project access — at parity with the canvas and extension. 63 unit
tests across the schema, timeline logic, canvas geometry, the RTDB reader/writer and the
MCP matcher/anchor resolver.
