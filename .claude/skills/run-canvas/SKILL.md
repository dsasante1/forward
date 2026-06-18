---
name: run-canvas
description: Runs the Forward web canvas (apps/canvas) locally — offline against public/fixture.json, no Firebase or auth needed — to verify a change by eye. Use when asked to "run the canvas", "start the editor", "see this change in the app", "test the canvas locally", or to confirm drawing/resize/nesting, the API drawer, the endpoint timeline, or the infra overlay actually work. Not for the VS Code extension (a separate build) or for pure logic that unit tests already cover.
metadata:
  version: 1.0.0
---

# Running the canvas locally

The canvas ([apps/canvas](../../../apps/canvas)) is a Vite app that runs **fully offline**
against [apps/canvas/public/fixture.json](../../../apps/canvas/public/fixture.json) — no
Firebase, no auth, no setup. This is the fastest way to eyeball a design/canvas change.

## Run

From the repo root:

```bash
npm run dev:canvas      # vite dev server (offline, off the fixture)
```

Vite prints a `localhost` URL. The offline fixture source skips auth and project
membership entirely, so you can draw, move/resize, nest, make components/instances, open
the API drawer, and toggle the endpoint **History** timeline immediately.

If shared types changed, build first so the canvas picks them up:

```bash
npm run build -w packages/shared && npm run dev:canvas
```

## Other data sources

- **Local mock RTDB** — `npm run mock` (starts [apps/mock-rtdb](../../../apps/mock-rtdb)),
  then `npm run seed:mock` to load data. Also auth-free.
- **Live Firebase RTDB** — needs `npm run setup` to write `apps/canvas/.env.local` and
  enable Anonymous sign-in in the Firebase console; the locked rules then enforce the
  per-project membership ACL.

## Verify a change

For logic, prefer the unit tests — they're faster and don't need a browser:

```bash
npm test -w apps/canvas        # vitest (geometry, etc.)
npm run typecheck -w apps/canvas
```

Use the running app to confirm rendering/interaction the tests can't (drag, snap, nesting,
the git-graph timeline). When asked to confirm a change "works in the app," run the dev
server and report what you observe, not just that tests pass.

## Troubleshooting

- **The canvas is blank or shows stale data after a shared-types change.** Cause: the dev server is serving the old build of `forward-core`. Solution: `npm run build -w packages/shared`, then restart `npm run dev:canvas`.
- **Live Firebase mode shows an "enrol your uid" banner / locked out.** Expected: the per-project membership ACL. Solution: have an existing member paste your uid into the **+Member** control, or use the offline fixture / `npm run mock` which skip auth entirely.
- **`npm run dev:canvas` exits immediately.** Cause: usually a stale `apps/canvas/.env.local` or missing deps. Solution: `npm install` at the root; for offline use no env is required.
