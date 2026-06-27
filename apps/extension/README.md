# Forward — VS Code Extension

Document your API endpoints (any language/framework) directly onto design
elements drawn on a visual canvas — a developer-first alternative to Figma Code
Connect.

## What it does

From inside VS Code you can:

- **Document API on Design Element** — pick a design element the designer made
  on the canvas and attach an endpoint, method, request/response shape, etc.
- **Open Design Canvas** — view the live design with your API docs overlaid.
- **Remove API Documentation** — detach the binding (the design element stays).
- **Infrastructure overlay** — add/link/remove infrastructure nodes on the canvas.
- **Endpoint timeline** — the canvas's **Timeline** button opens a git-graph of
  every endpoint's created/modified/deleted history, plus a catch-up digest of
  what to integrate, modify or remove since a chosen baseline.

The companion web canvas is where designers draw the UI.

## Setup

1. Install this extension.
2. Open **Settings → Forward** and set `forward.apiBaseUrl` to your Forward
   server URL (e.g. `http://localhost:8080` or `https://api.forward.dev`).
3. In the Forward dashboard, open **Account → Extension tokens**, generate a
   Personal Access Token, and copy it (it's shown only once).
4. Run **Forward: Sign In** (Command Palette) and paste the token. It's stored
   securely in VS Code's SecretStorage — never in settings.
5. Run **Forward: Select Project** to choose which project to annotate (this sets
   `forward.projectId`; it must match the canvas's `VITE_CANVAS_PROJECT_ID`).

Sign out any time with **Forward: Sign Out**. The token grants exactly your own
project access — every request is authenticated per-user by the server.

## License

Proprietary. All rights reserved.
