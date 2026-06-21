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
2. Open **Settings → Forward** and set:
   - `forward.firebaseDatabaseUrl` — your Firebase RTDB URL.
   - `forward.projectId` — the canvas namespace to annotate under
     (must match the canvas's `VITE_CANVAS_PROJECT_ID`).
   - `forward.authToken` — *(optional)* a Firebase auth token / DB
     secret, only if your database rules require auth. **Put this in your User
     settings, not committed workspace settings.**

## License

Proprietary. All rights reserved.
