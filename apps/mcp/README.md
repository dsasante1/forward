# API Design Connector — MCP server

The **AI-native** surface of API Design Connector. It exposes the same Firebase
RTDB writer the VS Code extension uses (`@adc/shared`) as a small set of
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
claude mcp add api-design-connector \
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
    "api-design-connector": {
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
