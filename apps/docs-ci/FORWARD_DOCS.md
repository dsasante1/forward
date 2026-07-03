# Forward docs — instructions for your AI

You are updating the project's **Forward** documentation to match code that was
just merged. Read the diff, work out what changed, and write a single file,
**`forward-docs.json`**, describing the documentation updates. That's your whole
job — you do **not** call any API, you do **not** need any credentials, and you
do **not** touch the Forward project directly. A separate deterministic step
(`forward-docs apply`) takes the file you write and does the credentialed write.

This file is model-agnostic on purpose: hand it to whatever agent you use
(Claude, GPT, Gemini, a local model — anything that can read a repo and write a
file). Nothing here is Forward- or vendor-specific beyond the JSON shape below.

## 1. Find what changed

The merge range is provided in the environment:

- `FORWARD_DIFF_BASE` — the commit before the merge
- `FORWARD_DIFF_HEAD` — the merge commit

Get the changed files and their contents:

```bash
git diff --name-only "$FORWARD_DIFF_BASE" "$FORWARD_DIFF_HEAD"
git diff "$FORWARD_DIFF_BASE" "$FORWARD_DIFF_HEAD"
```

Only document things that actually changed in this range. If nothing in the diff
is worth documenting, write `{"version":1}` and stop — that's a valid no-op.

## 2. Resolve elements with `@adc` anchors

API documentation attaches to a **design element** on the Forward canvas. The
link is an anchor comment a developer left next to the code, of the form:

```
// @adc el_9f2c   ← this endpoint documents design element el_9f2c
```

For every changed endpoint, find its nearest `@adc <id>` anchor and use that id
as `elementId`. **If a changed endpoint has no anchor, skip its API binding** —
do not invent an id (a wrong id would document the wrong button). You may still
add entities/infra for it; those are not anchored.

## 3. Write `forward-docs.json`

Emit **only** semantic content. Do **not** include coordinates, sizes, or
timestamps — the apply step positions new nodes and stamps times for you, and
preserves the position of anything that already exists. Every field is optional
except the ids/names noted; include only the layers this merge actually affected.

```jsonc
{
  "version": 1,

  // Optional. Overrides the safety checkpoint apply takes before writing.
  "checkpoint": { "title": "Docs for #123", "note": "auth refactor" },

  // API docs — one per changed endpoint that has an @adc anchor.
  "bindings": [
    {
      "elementId": "el_9f2c",              // required — from the @adc anchor
      "title": "POST /auth/login",         // required — method + path or a name
      "description": "Markdown. Params, request/response, auth, errors.",
      "action": "created"                  // "created" | "modified" | "deleted"
      // Use "deleted" ONLY when the endpoint was removed in this merge: apply
      // then REMOVES the element's binding (still set title so the history entry
      // is labelled). "created"/"modified" attach or update the docs.
      // "version" / "changeLog" are auto-filled from the commit if omitted
    }
  ],

  // ER / data model. `id` is a stable slug you choose and REUSE across runs
  // (e.g. "ent_user") so re-runs update the same table instead of duplicating.
  "entities": [
    {
      "id": "ent_user",
      "name": "User",
      "description": "Application account.",
      "fields": [
        { "name": "id",    "type": "uuid",    "keys": ["PK"] },
        { "name": "email", "type": "varchar", "keys": ["UK"] }
      ]
    }
  ],
  "entityRelations": [
    {
      "id": "rel_user_session",
      "from": "ent_user", "to": "ent_session",
      "fromCardinality": "exactly-one",     // zero-or-one | exactly-one | zero-or-many | one-or-many
      "toCardinality": "zero-or-many",
      "label": "has", "identifying": true
    }
  ],

  // Infrastructure graph. Same rule: stable, reused ids.
  "infraNodes": [
    { "id": "svc_api", "kind": "backend", "label": "Auth API", "tech": "NestJS",
      "description": "Issues + verifies sessions." },
    { "id": "svc_db", "kind": "database", "label": "Postgres", "tech": "v15" }
  ],
  "infraEdges": [
    { "id": "edge_api_db", "from": "svc_api", "to": "svc_db", "label": "reads/writes" }
  ],

  // Narrated flows over the infra nodes. `from`/`to` are infraNode ids.
  // `endpointId` optionally ties a hop to a binding's elementId.
  "infraFlows": [
    {
      "id": "flow_login", "name": "User login",
      "steps": [
        { "from": "svc_api", "to": "svc_db", "label": "verify credentials",
          "kind": "sync", "endpointId": "el_9f2c" }
      ]
    }
  ],

  // Agent / MCP layer. Document MCP servers your project builds or consumes, and
  // the agents wired to them. A tool's `endpointId` may point at a binding's
  // elementId; an agent's `mcpServerIds` reference the mcpServers ids below.
  "mcpServers": [
    {
      "id": "mcp_forward", "label": "forward-mcp",
      "transport": "stdio",           // stdio | http | sse
      "origin": "built",              // "built" (you expose it) | "consumed" (third-party)
      "description": "Documents the canvas.",
      "tools": [
        { "name": "connectEndpoint", "description": "Attach API docs.", "endpointId": "el_9f2c" }
      ]
    }
  ],
  "agents": [
    {
      "id": "agent_docs", "label": "docs agent",
      "model": "claude-opus-4-8",
      "systemPrompt": "You document endpoints on the Forward canvas.",
      "mcpServerIds": ["mcp_forward"]
    }
  ]
}
```

### Field rules that matter

- **Reuse ids across runs.** An `id` you used last time updates that node;
  a new `id` creates a new one. Pick deterministic slugs (`ent_user`,
  `svc_api`), not random ones, so documentation converges instead of piling up.
- **`kind`** for an infra node must be one of Forward's infra kinds: `frontend`,
  `backend`, `database`, `cache`, `queue`, `service`, `devops`, `external`,
  `group`. Match how the rest of the project's graph is labelled.
- **Markdown** is allowed in every `description`.
- Reference an edge/relation/flow-step only between ids you also define here or
  that already exist in the project.

## 4. Done

Write the file to the repo root as `forward-docs.json`. The workflow runs
`forward-docs apply forward-docs.json` next, which validates it, takes a
checkpoint, and writes it to the Forward project. If your file is malformed the
apply step fails loudly and writes nothing — so prefer omitting a layer you're
unsure about over guessing.
