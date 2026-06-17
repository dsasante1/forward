# Schema Nexus — MCP server

The **AI-native** surface of Schema Nexus. It exposes the same Firebase
RTDB writer the VS Code extension uses (`schema-nexus-core`) as a small set of
[Model Context Protocol](https://modelcontextprotocol.io) tools, so **any**
MCP-capable agent (Claude Code, Cursor, …) can document a design element for you.

A backend dev who just finished a feature can say:

> "Document the login endpoint I just built on the canvas."

…and the agent finds the matching design element and writes the docs — no
quick-pick, no form. The read-only canvases (web + VS Code) pick up the change
live.

## Tools

| Tool | What it does |
|---|---|
| `list_design_elements` | List the canvas elements (id, name, type, text, whether documented) |
| `find_element` | Rank elements against a feature description — solves "which element is the login one?" |
| `resolve_anchors` | Resolve `@adc <elementId>` markers in source to design elements — deterministic linking |
| `get_documentation` | Read one element's current binding before editing |
| `write_documentation` | Attach/replace docs on an element (appended to version history) |
| `remove_documentation` | Strip docs off an element |
| `get_history` | Read one element's full documentation version history (created/modified/deleted) |
| `get_catchup_digest` | Net to-integrate / to-modify / to-remove since a baseline (24h/7d/30d/all) |
| `list_infra` | Read the infrastructure graph (nodes + edges) + a UML component diagram (Mermaid) of it |
| `write_infra_node` | Create or update an infra node (database, cache, service, …) |
| `connect_infra` | Draw a directed edge between two infra nodes |
| `remove_infra_node` | Delete an infra node and any edges touching it |
| `list_flows` | Read the narrated flows over the infra graph (steps + a UML sequence diagram in Mermaid) |
| `write_flow` | Create or replace a flow — an ordered path of steps through the infra nodes |
| `add_flow_step` | Append one hop to an existing flow (e.g. document Redis's role in signup) |
| `remove_flow` | Delete a flow (its infra nodes/edges are left untouched) |
| `create_element` | Draw a new design element (frame / rectangle / text / component / instance) |
| `update_element` | Move / resize / rename / restyle / re-parent an element (partial update) |
| `delete_element` | Remove an element (cascades to nested descendants by default) |
| `list_members` | Read the project's access roster (uid + role) |
| `add_member` | Enrol a uid into the roster (REST-side of the canvas' 👤 +Member) |
| `remove_member` | Revoke a uid's access |

These tools give an agent **parity with the canvas and extension** — every data
pillar is reachable: the **design** layer (read + author), the **API
documentation** layer (read/write + history), the **infrastructure** graph and
its narrated **flows** (read/write, plus a UML component diagram from `list_infra`
and a UML sequence diagram per flow from `list_flows`, both as Mermaid — the same
diagrams the canvas renders), the project **timeline** (read via `get_history` /
`get_catchup_digest`; writes flow through the documentation tools), and **access
control** (the member roster). Designers still normally own the design layer on
the canvas, so prefer documenting existing elements over drawing new ones —
`create_element` is there for when the design is genuinely missing what you built.

The `write_documentation` input schema is derived from the shared `ApiBinding`
contract, so the structured fields (`method`, `endpoint`, `parameters`, …) stay
in lock-step with [packages/shared](../../packages/shared).

## Configuration (BYOD)

The server holds the Firebase credentials; the agent never sees them. Set:

| Env var | Required | Meaning |
|---|---|---|
| `ADC_FIREBASE_DATABASE_URL` | yes | Your Firebase Realtime Database URL |
| `ADC_PROJECT_ID` | yes | Canvas project id (must match the extension / canvas) |
| `ADC_AUTH_TOKEN` | if rules require auth | Firebase ID token / DB secret |
| `ADC_AGENT` | no | Author label recorded in the version history for writes (default `agent`) |

## Build & run

```bash
npm run build -w apps/mcp     # compile to dist/
npm test -w apps/mcp          # unit tests (the matcher)
npm start -w apps/mcp         # run over stdio (normally launched by the agent)
```

## Register with an agent

Point your MCP client at the built server. For example, Claude Code:

```bash
claude mcp add schema-nexus \
  --env ADC_FIREBASE_DATABASE_URL=https://YOUR-db.firebaseio.com \
  --env ADC_PROJECT_ID=your-project \
  --env ADC_AUTH_TOKEN=your-token \
  -- node /absolute/path/to/apps/mcp/dist/server.js
```

Or the equivalent JSON in any MCP client (Cursor `mcp.json`, Claude Desktop
`claude_desktop_config.json`, …):

```json
{
  "mcpServers": {
    "schema-nexus": {
      "command": "node",
      "args": ["/absolute/path/to/apps/mcp/dist/server.js"],
      "env": {
        "ADC_FIREBASE_DATABASE_URL": "https://YOUR-db.firebaseio.com",
        "ADC_PROJECT_ID": "your-project",
        "ADC_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

## Linking: fuzzy or deterministic

Two ways to answer "which design element does this code belong to?":

- **Fuzzy — `find_element`.** Matches a feature description to an element by
  token overlap. No setup, but fuzzy, so confirm with the user when the score is
  low or two candidates are close.
- **Deterministic — `resolve_anchors`.** Pin the link in the source itself, the
  Figma Code Connect model. Drop an `@adc <elementId>` marker (any comment style)
  next to the code that implements the element:

  ```ts
  // @adc el_login_submit
  app.post("/api/v1/login", loginHandler);
  ```

  Then point `resolve_anchors` at the file or directory and it returns the exact
  element id — unambiguous, re-runnable (CI-friendly), no guessing. It also flags
  anchors whose id doesn't exist on the canvas, catching typos and stale links.

A typical agent flow: `resolve_anchors` on the files you touched → if none,
`find_element` on the feature description → `write_documentation` on the chosen id.
