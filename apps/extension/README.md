# Forward — VS Code Extension

Document your API endpoints (any language/framework) directly onto design
elements drawn on a visual canvas.

## What it does

From inside VS Code you can:

- **Document API on Design Element** — pick a design element the designer made
  on the canvas and attach an endpoint, method, request/response shape, etc.
  Docs are framework-agnostic Markdown, so any language/stack fits.
- **Insert Anchor at Cursor (@adc)** — pick a design element by name and drop an
  `@adc <id> "Label"` comment at the cursor in your file's own comment syntax.
  It pins the code↔element link in the source — no opaque id to transcribe — so
  CI (or an MCP agent) can re-document that endpoint deterministically.
- **Remove API Documentation** — detach the binding (the design element stays).
- **Infrastructure diagram** — add, link and remove infrastructure nodes to map
  your architecture as a component diagram.
- **Flows & sequence diagrams** — narrate ordered hops across your
  infrastructure; they render as a Mermaid sequence diagram. A step can carry an
  optional branch guard — steps sharing one condition render as an `alt`/`else`.
- **Tasks** — file tasks with an optional start date, due date (`YYYY-MM-DD`),
  type (a milestone is a single date) and the tasks they depend on, optionally
  linked to a design element (picked up from an `@adc` anchor under the
  cursor). **Update Task** changes the schedule, dependencies, priority or type;
  **Update Task Status** is the quick "mark done".
- **Task timeline** — **Show Task Timeline** opens the canvas on a Gantt view
  of the tasks: bars from start to due date, milestones, and dependency arrows.
- **Validate** — the same checks as `forward validate` in CI (bad files,
  broken links, non-ISO due dates, dependency cycles) show in the Problems
  panel and update as `.forward/` changes. **Validate Project** runs them on
  demand.
- **Open Design Canvas** — the full canvas editor (design, API docs, infra,
  flows, data model, tasks, checkpoints) right inside VS Code. It refreshes when
  `.forward/` changes, whether you, a teammate's pull or an AI agent changed it.
- **Endpoint timeline** — the canvas's **Timeline** button opens a git-graph of
  every endpoint's created/modified/deleted history, plus a catch-up digest of
  what to integrate, modify or remove since a chosen baseline.

Everything you write is stored as plain JSON in the `.forward/` directory of
your repository, one file per record. Commit it with the code it describes; your
team, the canvas and any AI agents stay in sync through git.

## Setup

1. Install this extension and open your repository in VS Code.
2. If the repository has no `.forward/` yet, run **Forward: Initialize Project in
   This Repository** (Command Palette). Or run
   `npx -y -p forward-mcp forward init` in a terminal, which also writes agent
   configs and a GitHub workflow.

That's all. There is no account, server URL, token or project picker: the
extension finds `.forward/` in the workspace automatically, and access is
whatever your git host grants.

## Connect an AI agent (MCP)

Want an AI agent (Claude Code, Codex, Cursor, …) to do the same documentation
work? It uses the **[Forward MCP server](../mcp/README.md)**, which reads the
same `.forward/` files.

1. Run **Forward: Set Up MCP for AI Agents**. It copies
   `claude mcp add forward -- npx -y forward-mcp` to your clipboard.
2. Run it in a terminal at the repository root.
3. **Restart your agent session** so it loads the Forward tools.

For Cursor, VS Code Copilot and Codex, run `npx -y -p forward-mcp forward agents`.

## Automate documentation in your CI/CD

1. **Anchor your code.** Drop an `@adc <elementId>` comment next to the
   handler that implements a design element (any comment syntax works). Type
   it by hand, or run **Forward: Insert Anchor at Cursor (@adc)** to pick the
   element by name:

       // @adc el_login_submit "Login submit"
       app.post("/api/v1/login", loginHandler)

   The anchor pins the code↔element link in the source itself, so an
   unattended pipeline needs no confirm step.
2. **Let an AI document each pull request.** The
   [forward-docs pipeline](../docs-ci/README.md) runs your own AI on the diff
   and commits the resulting `.forward/` changes back to the PR branch.
3. **Review it like code.** The Forward GitHub Action posts a catch-up digest
   on every pull request listing new, changed and removed endpoints.

## License

Apache License 2.0.
