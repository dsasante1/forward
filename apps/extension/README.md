# Forward — VS Code Extension

Document your API endpoints (any language/framework) directly onto design
elements drawn on a visual canvas.

## What it does

From inside VS Code you can:

- **Document API on Design Element** — pick a design element the designer made
  on the canvas and attach an endpoint, method, request/response shape, etc.
  Docs are framework-agnostic Markdown, so any language/stack fits.
- **Remove API Documentation** — detach the binding (the design element stays).
- **Infrastructure diagram** — add, link and remove infrastructure nodes to map
  your architecture as a component diagram.
- **Flows & sequence diagrams** — narrate ordered hops across your
  infrastructure; they render as a Mermaid sequence diagram.
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

## License

Proprietary. All rights reserved.
