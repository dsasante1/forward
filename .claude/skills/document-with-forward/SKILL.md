---
name: document-with-forward
description: Drives the Forward MCP server to do the backend dev's real jobs — attach API docs to the design element you just built, edit the infrastructure diagram/flows, and catch up on endpoint changes since a baseline. Use when the forward MCP tools are connected and the user says things like "document the login endpoint I built", "map this endpoint to its button", "add a Redis cache to the architecture diagram", "what endpoints changed this week", or "give a frontend dev the catch-up digest". Requires the forward MCP server; do NOT use to edit the MCP server's own code (use add-mcp-tool) or the shared contract (use schema-change).
metadata:
  version: 1.0.0
  mcp-server: forward
---

# Driving Forward over MCP

The forward MCP server gives you full parity with the canvas: author/document design
elements, edit the infrastructure graph, read the endpoint timeline, and manage project
access. This skill is the *recipe layer* — which tools to call, in what order, with what
guardrails. It assumes the server is already connected; if tool calls fail, see
Troubleshooting.

## Guardrails (apply to every workflow)

- **Document existing elements; don't draw new ones.** Designers own the canvas. Reach for
  `create_element` only when the design is genuinely missing the thing you built — prefer
  finding and documenting what's already there.
- **Confirm the target before writing.** When `find_element`'s top score is low or two
  candidates are close, show the user the candidates and confirm the element id first.
- **Never invent API details.** Method, path, params, and responses come from the code or
  the user — don't guess them to fill a field.

## Workflow 1 — Document an endpoint you built (the core job)

Pattern: locate the element → check what's there → write the binding.

1. **Locate the design element.** Choose the tool by context:
   - If the developer anchored code with `@adc <elementId>` comments, use
     **`resolve_anchors`** (pass a file/dir `path` or raw `source`). It's deterministic and
     flags stale/typo ids — always prefer it when anchors exist.
   - Otherwise use **`find_element`** with a natural-language query ("login form") and
     confirm the id per the guardrail above.
2. **Check existing docs** with **`get_documentation`** for that element id, so you update
   rather than blindly overwrite.
3. **Write the binding** with **`write_documentation`** (title, method, path, params,
   responses, etc.). It creates or updates and reports which it did.
4. To pull docs back off an element, use **`remove_documentation`**.

## Workflow 2 — Edit the infrastructure diagram

1. **`list_infra`** to see current nodes/edges before changing anything.
2. **`write_infra_node`** to create/update a node (e.g. a Redis cache, a service, a queue).
3. **`connect_infra`** to draw an edge between two node ids.
4. **`remove_infra_node`** to delete one.

For request/sequence **flows**: **`list_flows`** → **`write_flow`** (create/replace a named
flow) → **`add_flow_step`** (append a step) → **`remove_flow`**.

## Workflow 3 — Catch up on endpoint changes

- **`get_catchup_digest`** with a baseline ("last 24 h / 7 d / 30 d / all time") collapses
  the stream into the net *to integrate / to modify / to remove* lists a frontend dev acts
  on. This is the tool for "what changed this week".
- **`get_history`** returns one element's full created/modified/deleted timeline when you
  need the detail behind a digest line.

## Workflow 4 — Project access

**`list_members`** to see the roster; **`add_member`** / **`remove_member`** (by uid) to
enrol or remove collaborators. There's no open self-join — enrolment is deliberately
explicit.

## Examples

- User: *"I just built the POST /login handler — document it."* → `resolve_anchors` on the
  handler file (or `find_element "login"`), confirm the element, `get_documentation`, then
  `write_documentation` with the method/path/params from the code.
- User: *"Add a Redis cache between the API and the database."* → `list_infra`,
  `write_infra_node` (Redis), then `connect_infra` API→Redis and Redis→DB.
- User: *"What endpoints changed in the last week?"* → `get_catchup_digest` with a 7-day
  baseline; offer `get_history` on any line they want to drill into.

## Troubleshooting

- **Tool calls fail / "server not connected".** Cause: the forward MCP server isn't
  running or configured. Solution: confirm it's connected in your client's MCP settings; the
  server holds the Firebase credentials, so a config/credential problem there blocks every
  tool.
- **`resolve_anchors` reports an anchor whose `exists` is false.** Cause: a typo or stale
  `@adc` id in the source. Solution: fix the id in code (or pick the right element via
  `find_element`) before writing docs.
- **`find_element` scores are all low.** Cause: the element may not exist yet, or the query
  is vague. Solution: refine the query, or confirm with the user whether the design element
  exists before considering `create_element`.