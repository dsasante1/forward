# API Design Connector

An open-source, developer-first alternative to Figma Code Connect. Map backend API
routes and documentation directly onto an independent, open-source visual design canvas,
using a **Bring-Your-Own-Database (BYOD)** model backed by the Firebase Realtime Database.

```
[VS Code Extension] --(parse & push docs)--> [Your Firebase RTDB] <--(live sync)--> [Web Canvas]
```

## Monorepo layout

This is an npm-workspaces monorepo. The shared schema is the contract between all parts —
change it there once and both apps stay in sync.

| Path | What it is |
|---|---|
| [packages/shared](packages/shared) | Zod schemas + TS types for the Firebase JSON tree (the data contract) |
| [apps/extension](apps/extension) | VS Code extension: highlight a route → parse → push to Firebase |
| [apps/canvas](apps/canvas) | Web canvas: SVG blocks bound to API schemas + live version history |

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

Phase 0 scaffold. See the build phases in the project proposal.
