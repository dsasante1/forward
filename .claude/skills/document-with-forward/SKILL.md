---
name: document-with-forward
description: Drives the Forward MCP server to do the backend dev's real jobs — attach API docs to the design element you just built, edit the infrastructure diagram/flows, and catch up on endpoint changes since a baseline. Use when the forward MCP tools are connected and the user says things like "document the login endpoint I built", "map this endpoint to its button", "add a Redis cache to the architecture diagram", "what endpoints changed this week", or "give a frontend dev the catch-up digest". Requires the forward MCP server; do NOT use to edit the MCP server's own code (use add-mcp-tool) or the shared contract (use schema-change).
metadata:
  version: 1.1.0
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
  `create_element` or `import_design_from_code` only when the design is genuinely missing the
  thing you built — prefer finding and documenting what's already there.
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

## Workflow 4 — Work the task tracker

Tasks are the project's work items; they optionally link into the other layers
(`elementId` / `flowId` / `endpointId`). Every change you make is recorded in the task's
activity feed attributed to the agent, exactly as the canvas records human changes — so
prefer these tools over guessing state.

1. **`list_tasks`** to survey work — filter by `status`, `type`, `priority`, `label`,
   `assignee`, or any link id (e.g. "high-priority bugs for the signup flow"). It returns a
   summary per task (no feed) plus an `activityCount`.
2. **`get_task`** to read one task in full *including its activity/comment feed* — do this to
   catch up before you change or comment on a task, so you act on the current state.
3. **`create_task`** to file work (title + optional type/status/priority/labels/assignees/
   dueDate/links). A sequential `FWD-NN` key and the agent as reporter are assigned for you.
4. **`update_task`** to change fields (status, type, priority, labels, assignees, dueDate,
   title/description, links). Only the fields you pass change; each is logged in the feed.
5. **`comment_task`** to post into the discussion thread humans use — report progress, ask a
   question, or record a decision. Read with `get_task` first so it lands in context.
6. **`delete_task`** to remove a work item (its linked layers are untouched).

## Workflow 5 — A screen exists in code but has no design

Pattern: dry run → import → review → anchor.

1. **`import_design_from_code`** with `url` + `routes` (live capture with a Chromium-based
   browser already installed, or the project's Playwright; `browser` picks one) or
   `snapshotPath` (files from `forward capture --script` run in DevTools, e.g. in Firefox or
   Safari, which can't be driven live). Pass
   `dryRun: true` first and show the user the counts.
2. Run it for real. Drafts land as one frame per route, marked "from code" on the canvas.
   Re-running updates untouched drafts. `conflicts` are drafts someone edited, and `skipped`
   are hand-drawn or adopted elements. Leave both alone and tell the user. Relay the `next`
   hints: `stale` drafts (pass `prune` only if the user agrees), `dismissed` drafts someone deleted
   (pass `restoreDismissed` only if asked), and how many anchors `writeAnchors` would add.
3. Tidy names with `update_element` if the user asks. An edited draft is never overwritten
   by a later import, so do this only once the screen is settled.
4. `writeAnchors: true` adds `// @adc <id>` above each component's declaration. It edits
   source files, so only do it when the user agrees.
5. **Fallback when the app can't run:** read the route's components and sketch the screen
   with `create_element` (a frame per screen, boxes and text inside), then say it is a
   rough wireframe from the source, not a capture.

## Workflow 6 — Project access

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
- User: *"File a high-priority bug for the signup 500 and assign it to me."* → `create_task`
  (type bug, priority high, the signup element/endpoint as a link); then `comment_task` if
  there's context to record.
- User: *"Mark the promo-code task done and note it's verified."* → `list_tasks` to find it,
  `update_task` status done, `comment_task` "verified in staging".

## Troubleshooting

- **Tool calls fail / "server not connected".** Cause: the forward MCP server isn't
  running or can't find the project. Solution: confirm it's connected in your client's MCP
  settings and started inside the repository (or `FORWARD_REPO` points at it), and that
  `.forward/forward.json` exists (`forward init`). Without MCP, run the same tool with the
  `forward` CLI.
- **`resolve_anchors` reports an anchor whose `exists` is false.** Cause: a typo or stale
  `@adc` id in the source. Solution: fix the id in code (or pick the right element via
  `find_element`) before writing docs.
- **`find_element` scores are all low.** Cause: the element may not exist yet, or the query
  is vague. Solution: refine the query, or confirm with the user whether the design element
  exists before considering `create_element`.