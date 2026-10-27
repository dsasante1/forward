---
name: run-canvas
description: Runs the Forward canvas to verify a change by eye. The canvas is served by the `forward serve` CLI command over a repository's .forward/ directory (or by Vite via `npm run dev:host -w apps/canvas`). Use when asked to "run the canvas", "start the editor", "see this change in the app", or to confirm drawing/resize/nesting, the API drawer, the endpoint timeline, or the infra overlay actually work. Not for the VS Code extension (a separate build) or for pure logic that unit tests already cover.
metadata:
  version: 3.0.0
---

# Running the canvas

The canvas ([apps/canvas](../../../apps/canvas)) is mounted by the standalone host page in
[apps/canvas/host](../../../apps/canvas/host). `forward serve` serves that page plus the REST
routes over a repository's `.forward/` directory, so running the canvas means pointing the CLI
at a repo that has a Forward project.

## Run

Build, then serve a scratch project (any directory works; a git repo also gets a History feed):

```bash
npm run build                                  # shared → canvas host → CLI
mkdir -p /tmp/fwd-demo && cd /tmp/fwd-demo && git init -q
node <repo>/apps/mcp/dist/cli.js init --no-agents --no-github
node <repo>/apps/mcp/dist/cli.js serve         # prints http://127.0.0.1:4747/
```

Seed data from the shell with the same tools agents use, e.g.
`node <repo>/apps/mcp/dist/cli.js create_element --type frame --name Login --x 0 --y 0 --width 400 --height 600`.

For a fast edit loop on canvas code, run Vite on the host (`npm run dev:host -w apps/canvas`)
and keep `forward serve` running for the data; or rebuild the canvas and restart `serve`.

To check the read-only GitHub Pages view: `forward export --out /tmp/site`, then serve that
folder with any static server.

## Verify a change

For logic, prefer the unit tests — faster, no browser:

```bash
npm test -w apps/canvas         # vitest (geometry, etc.)
npm run typecheck -w apps/canvas
```

Use the running app to confirm rendering/interaction the tests can't (drag, snap, nesting,
the git-graph timeline, the UML overlay). When asked to confirm a change "works in the
app," run it and report what you observe, not just that tests pass. Headless:
`chromium --headless=new --screenshot=out.png --virtual-time-budget=8000 http://127.0.0.1:4747/`.

## Troubleshooting

- **"The canvas UI isn't built."** `forward serve` can't find the host build. Run
  `npm run build -w apps/canvas` (then `npm run build -w apps/mcp` to copy it into `dist/ui`).
- **Canvas is stale after a shared-types change.** Rebuild: `npm run build -w packages/shared`,
  then the canvas, then restart `serve`.
- **API calls return 401 or 421.** The page must be opened at the exact URL `serve` printed:
  the session token is injected into that page, and other Host headers are rejected.
- **Styles look unstyled.** The canvas renders into a Shadow DOM and injects
  [apps/canvas/src/canvas.css](../../../apps/canvas/src/canvas.css) as a string (`?inline`);
  a broken import shows unstyled markup. Check the canvas build/typecheck.
