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
- **Tasks** — file tasks and update their status, optionally linked to an
  element, flow or endpoint.
- **Open Design Canvas** — view the live design with your API docs and diagrams
  overlaid, right inside VS Code.
- **Endpoint timeline** — the canvas's **Timeline** button opens a git-graph of
  every endpoint's created/modified/deleted history, plus a catch-up digest of
  what to integrate, modify or remove since a chosen baseline.

Everything you write syncs through the centrally-hosted Forward server, so your
team, the design canvas and any AI agents stay in sync in real time. The
companion web canvas is where designers draw the UI.

## Setup

1. Install this extension. It's preconfigured to talk to the hosted Forward
   server, so there's nothing to set for `forward.apiBaseUrl` — only change it
   in **Settings → Forward** if you run a self-hosted or local server (e.g.
   `http://localhost:8080`).
2. In the Forward dashboard, open **Account → Extension tokens**, generate a
   Personal Access Token, and copy it (it's shown only once).
3. Run **Forward: Sign In** (Command Palette) and paste the token. It's stored
   securely in VS Code's SecretStorage — never in settings.
4. Run **Forward: Select Project** to choose which project to annotate (this sets
   `forward.projectId`; it must match the canvas's `VITE_CANVAS_PROJECT_ID`).

Sign out any time with **Forward: Sign Out**. The token grants exactly your own
project access — every request is authenticated per-user by the server.

## Connect an AI agent (MCP)

Want an AI agent (e.g. Claude Code) to do the same documentation work? It talks
to Forward through the **[Forward MCP server](../mcp/README.md)** — a headless
sibling of this extension. You do **not** need a second token: a Personal Access
Token is user-scoped, so the one you already signed in with authorizes the MCP
server too. (The dashboard only stores a hash of a minted token, so this
extension's stored copy is the only place the plaintext still exists — which is
exactly why reusing it beats minting a fresh one.)

1. Run **Forward: Set Up MCP for AI Agents** (Command Palette). It copies a
   ready `claude mcp add forward …` command to your clipboard, pre-filled with
   your base URL, project id, and existing access token.
2. Paste it in your terminal.
3. **Restart your agent session** so it loads the newly-registered Forward
   tools — a running session won't pick them up automatically.

Only mint a *separate* token when you want independent revocation/audit for the
agent (for example, an unattended CI pipeline — see below).

## Automate documentation in your CI/CD

The extension is the human surface; its headless sibling — the **Forward MCP
server** — lets a pipeline agent do the same documentation work on merge, so
docs stay current without anyone opening the dashboard.

1. **Anchor your code.** Drop an `@adc <elementId>` comment next to the
   handler that implements a design element (any comment syntax works) — type
   it by hand, or run **Forward: Insert Anchor at Cursor (@adc)** to pick the
   element by name and have the extension write the comment (id + a readable
   label) for you:

       // @adc el_login_submit "Login submit"
       app.post("/api/v1/login", loginHandler)

   The anchor pins the code↔element link in the source itself — unambiguous
   and re-runnable, so an unattended pipeline needs no confirm step.
2. **Give CI a token.** Mint a dedicated `fwd_pat_…` PAT (**Account →
   Extension tokens**) and store it as a pipeline secret
   (`FORWARD_API_TOKEN`), alongside `FORWARD_API_BASE_URL` and
   `FORWARD_PROJECT_ID`.
3. **Run an MCP-capable agent on merge** to resolve the anchors in changed
   files and update each endpoint's docs. Every update lands in the element's
   version history, and the canvas reflects it instantly.

Full walkthrough — pipeline example and guardrails included:
[Forward docs → Automation & sync](https://forward-dashboard.web.app/docs#workflow).

## License

Proprietary. All rights reserved.
