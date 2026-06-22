---
name: run-canvas
description: Runs the Forward web canvas to verify a change by eye. The canvas is no longer standalone — it is embedded in the dashboard (apps/dashboard) at /app/projects/:projectId/canvas, so you run the dashboard. Use when asked to "run the canvas", "start the editor", "see this change in the app", or to confirm drawing/resize/nesting, the API drawer, the endpoint timeline, or the infra overlay actually work. Not for the VS Code extension (a separate build) or for pure logic that unit tests already cover.
metadata:
  version: 2.0.0
---

# Running the canvas

The canvas ([apps/canvas](../../../apps/canvas)) ships **only as an embedded library**
(`forward-canvas/embed` → `mountCanvas`). The dashboard's
[CanvasPage](../../../apps/dashboard/src/pages/CanvasPage.tsx) mounts it into a Shadow
DOM with a `ServerSource` backed by the live Clerk session, so running the canvas means
running the dashboard against the backend (`apps/server`).

## Run

```bash
npm run dev -w apps/dashboard    # Vite dev server (needs apps/dashboard/.env.local)
```

It needs `VITE_API_BASE_URL` (the running `apps/server`) and a Clerk publishable key.
Open a project, then the **Documentation** tab → "Open project in canvas" (or an
endpoint's "Open in canvas"), which routes to `/app/projects/:projectId/canvas`.

If shared types changed, build them first so both halves pick them up:

```bash
npm run build -w packages/shared && npm run dev -w apps/dashboard
```

## Verify a change

For logic, prefer the unit tests — faster, no browser:

```bash
npm test -w apps/canvas         # vitest (geometry, etc.)
npm run typecheck -w apps/canvas
```

Use the running app to confirm rendering/interaction the tests can't (drag, snap, nesting,
the git-graph timeline, the UML overlay). When asked to confirm a change "works in the
app," run the dev server and report what you observe, not just that tests pass.

## Troubleshooting

- **Canvas area is blank / stale after a shared-types change.** The dev server is serving
  an old build of `forward-core`. Run `npm run build -w packages/shared`, then restart.
- **Canvas shows "Not signed in" / empty.** The embedded `ServerSource` needs a live Clerk
  session and a reachable `VITE_API_BASE_URL`. Confirm you're signed in and the backend is up.
- **Styles look unstyled.** The canvas renders into a Shadow DOM and injects
  [apps/canvas/src/canvas.css](../../../apps/canvas/src/canvas.css) as a string (`?inline`);
  a broken import shows unstyled markup. Check the canvas build/typecheck.
