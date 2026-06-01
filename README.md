# API Design Connector

An open-source, developer-first alternative to Figma Code Connect. **Designers draw UI on
an independent, open-source visual canvas; backend developers then annotate those design
elements with API endpoints/docs straight from VS Code** — keeping frontend and backend in
sync. Built on a **Bring-Your-Own-Database (BYOD)** model backed by the Firebase Realtime
Database.

```
[Web Canvas: designers draw UI] --> [Your Firebase RTDB] <-- [VS Code: backend annotates elements]
                                       (live two-way sync)
```

## Two layers, one contract

The data model separates *design* from *API metadata*:

- **Design layer** — `DesignElement`s (frames, rectangles, text, components/instances) with
  geometry, hierarchy and style. This is what the designer creates and owns.
- **API binding** — an *optional* `apiBinding` attached to a design element by the backend.
  Most elements never get one; an endpoint is never a canvas object on its own.

## Monorepo layout

This is an npm-workspaces monorepo. The shared schema is the contract between all parts —
change it there once and both apps stay in sync.

| Path | What it is |
|---|---|
| [packages/shared](packages/shared) | Zod schemas + TS types for the design/binding tree (the data contract) |
| [apps/extension](apps/extension) | VS Code extension: pick a design element → write API docs (any language/framework) onto it |
| [apps/canvas](apps/canvas) | Figma-lite design editor (draw/move/resize/nest/components) + API drawer + version history |

## Using the canvas editor

Runs offline against [apps/canvas/public/fixture.json](apps/canvas/public/fixture.json) — no Firebase needed to try it.

- **Toolbar:** Move, Frame, Rect, Text; Comp (make selection a component), Inst (place an
  instance), Del.
- **Draw:** pick a tool and drag on the canvas. **Select** to move; drag the corner handle
  to resize. Dropping an element inside a frame nests it; edges snap to neighbours.
- **Right panel:** edit position/size/style, view the API binding the backend attached, and
  the endpoint's version history.

## Getting started

```bash
npm install              # installs all workspaces
npm run build            # build shared + apps
npm test                 # run all unit tests (Vitest)
npm run dev:canvas       # run the web canvas locally
```

## BYOD / privacy

No central server. Each user supplies their own Firebase config; data lives only in their
Realtime Database. Config is read from local settings / env and is **never committed**
(see [.gitignore](.gitignore)). Lock the database down with the security rules in
[apps/canvas/firebase.rules.json](apps/canvas/firebase.rules.json).

## Status

Figma-lite design editor + VS Code documentation bridge working offline end-to-end
(26 unit tests across schema, canvas geometry and the extension's RTDB writer). Next: wire
`LiveSource` to a real Firebase RTDB for live two-way sync.
