# forward-mcp — Forward for AI agents

The **AI-native** surface of [Forward](https://github.com/dsasante1/forward): an
[MCP](https://modelcontextprotocol.io) server and the `forward` CLI over a project of design
elements, API docs, infrastructure, flows, data model and tasks.

The project lives in **`.forward/` in your git repository**, so there is no server, account or
token. Run the server from the repository root and it finds the project:

```bash
npx -y -p forward-mcp forward init     # once: .forward/, AGENTS.md, .mcp.json, CI workflow
claude mcp add forward -- npx -y forward-mcp
```

A backend dev who just finished a feature can say:

> "Document the login endpoint I just built on the canvas."

…and the agent finds the matching design element and writes the docs as a file change, committed
with the code. Agents without MCP call the same tools through the CLI:

```bash
forward tools                          # every tool, one line each
forward tools write_documentation      # arguments for one tool
forward write_documentation --element-id el_1 --title "POST /login" --description "…"
forward call get_changes_since_ref '{"ref":"origin/main"}'
```

The CLI also runs the project: `forward serve` (canvas editor on `.forward/`), `forward validate`
(CI check), `forward diff <ref>` (PR catch-up digest), `forward export` (static GitHub Pages site)
and `forward agents` (agent configs for Claude Code, Cursor, VS Code and Codex).

### Configuration

| Variable | Meaning |
|---|---|
| `FORWARD_REPO` | Use this repository instead of searching up from the working directory |
| `FORWARD_AGENT` | Agent name appended to the author on writes, e.g. `Ada via claude` |
| `FORWARD_AUTHOR` | Author name for writes (default: git `user.name`) |

## Tools

| Tool | What it does |
|---|---|
| `project_info` | Start here: which project and repository, and counts per layer |
| `validate_project` | Check `.forward/` against the schema, ids and cross-layer links |
| `get_changes_since_ref` | New / changed / removed endpoints and per-layer changes since a git ref |
| `list_design_elements` | List the canvas elements (id, name, type, text, whether documented) |
| `find_element` | Rank elements against a feature description — solves "which element is the login one?" |
| `resolve_anchors` | Resolve `@adc <elementId>` markers in source to design elements — deterministic linking |
| `get_documentation` | Read one element's current binding before editing |
| `write_documentation` | Attach/replace docs on an element (appended to version history) |
| `remove_documentation` | Strip docs off an element |
| `get_history` | Read one element's full documentation version history (created/modified/deleted) |
| `get_catchup_digest` | Net to-integrate / to-modify / to-remove since a baseline (24h/7d/30d/all) |
| `list_infra` | Read the infrastructure graph (nodes + edges) + a component diagram (Mermaid) of it |
| `write_infra_node` | Create or update an infra node (database, cache, service, …) |
| `connect_infra` | Draw a directed edge between two infra nodes |
| `remove_infra_node` | Delete an infra node and any edges touching it |
| `list_flows` | Read the narrated flows over the infra graph (steps + a sequence diagram in Mermaid) |
| `write_flow` | Create or replace a flow — an ordered path of steps through the infra nodes |
| `add_flow_step` | Append one hop to an existing flow (e.g. document Redis's role in signup) |
| `remove_flow` | Delete a flow (its infra nodes/edges are left untouched) |
| `create_element` | Draw a new design element (frame / rectangle / text / component / instance) |
| `update_element` | Move / resize / rename / restyle / re-parent an element (partial update) |
| `delete_element` | Remove an element (cascades to nested descendants by default) |
| `import_design_from_code` | Generate design drafts from a running frontend (live with an installed Chromium-based browser or the project's Playwright, or DevTools snapshots); re-import updates untouched drafts only, re-matches drafts whose position shifted, and doesn't recreate deleted ones |
| `list_members` | Read who has contributed to `.forward/`, from git history (access is your git host's) |

These tools give an agent **parity with the canvas and extension** — every data
pillar is reachable: the **design** layer (read + author), the **API
documentation** layer (read/write + history), the **infrastructure** graph and
its narrated **flows** (read/write, plus a component diagram from `list_infra`
and a sequence diagram per flow from `list_flows`, both as Mermaid — the same
diagrams the canvas renders), the project **timeline** (read via `get_history` /
`get_catchup_digest`; writes flow through the documentation tools), and the
**contributor** roster. Designers still normally own the design layer on
the canvas, so prefer documenting existing elements over drawing new ones —
`create_element` is there for when the design is genuinely missing what you built.

The `write_documentation` input schema is derived from the shared `ApiBinding`
contract, so the structured fields (`method`, `endpoint`, `parameters`, …) stay
in lock-step with [packages/shared](../../packages/shared).

## Build & run

```bash
npm run build -w apps/mcp     # compile to dist/
npm test -w apps/mcp          # unit tests (matcher, anchors, CLI + tools in repo mode)
npm run pack -w apps/mcp      # self-contained npm package in pkg/ (needs the canvas host built)
npm start -w apps/mcp         # run over stdio (normally launched by the agent)
```

## Register with an agent

`forward agents` (or `forward init`) writes the configs for Claude Code, Cursor and VS Code into
the repository. To register by hand, run the server from the repository root:

```bash
claude mcp add forward -- npx -y forward-mcp
```

**After adding the server, restart your agent session.** A session that was
already running when you registered the server won't load its tools until it
reconnects — this is MCP-client behaviour, not a Forward setting.

The equivalent JSON for any MCP client (Cursor `mcp.json`, Claude Desktop, …):

```json
{
  "mcpServers": {
    "forward": {
      "command": "npx",
      "args": ["-y", "forward-mcp"],
      "env": { "FORWARD_AGENT": "claude", "FORWARD_REPO": "/absolute/path/to/your/repo" }
    }
  }
}
```

`FORWARD_REPO` is only needed when the client doesn't start the server inside the repository.

## Linking: fuzzy or deterministic

Two ways to answer "which design element does this code belong to?":

- **Fuzzy — `find_element`.** Matches a feature description to an element by
  token overlap. No setup, but fuzzy, so confirm with the user when the score is
  low or two candidates are close.
- **Deterministic — `resolve_anchors`.** Pin the link in the source itself. Drop
  an `@adc <elementId>` marker (any comment style) next to the code that
  implements the element:

  ```ts
  // @adc el_login_submit
  app.post("/api/v1/login", loginHandler);
  ```

  Then point `resolve_anchors` at the file or directory and it returns the exact
  element id — unambiguous, re-runnable (CI-friendly), no guessing. It also flags
  anchors whose id doesn't exist on the canvas, catching typos and stale links.

A typical agent flow: `resolve_anchors` on the files you touched → if none,
`find_element` on the feature description → `write_documentation` on the chosen id.
