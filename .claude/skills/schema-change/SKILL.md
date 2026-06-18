---
name: schema-change
description: Propagates a change to the Forward shared data contract (Zod schemas + inferred TS types in packages/shared — schema.ts, infra-flow.ts, timeline.ts, rtdb*.ts) across the canvas, VS Code extension, and MCP server so they stay in sync. Use when editing the design/binding tree or infra/timeline types — e.g. "add a field to DesignElement", "change the apiBinding shape", "new infra-node type", "edit forward-core", "the contract". Do NOT use for app-only UI/styling changes that don't touch packages/shared.
metadata:
  version: 1.0.0
---

# Changing the shared contract

`packages/shared` (the `forward-core` package) is the single contract every other
workspace depends on. Change it here once; all three apps consume the same types.

## Where things live

- [packages/shared/src/schema.ts](../../../packages/shared/src/schema.ts) — `DesignElement`, `ApiBinding`, `Style`, the design/binding tree.
- [packages/shared/src/infra-flow.ts](../../../packages/shared/src/infra-flow.ts) — `InfraNode`, `InfraEdge`, `InfraFlow`, `InfraFlowStep` + mermaid helpers.
- [packages/shared/src/timeline.ts](../../../packages/shared/src/timeline.ts) — endpoint version timeline + `digest`.
- [packages/shared/src/rtdb.ts](../../../packages/shared/src/rtdb.ts) / [rtdb-rest.ts](../../../packages/shared/src/rtdb-rest.ts) — Firebase RTDB reader/writer (SDK + REST).
- [packages/shared/src/index.ts](../../../packages/shared/src/index.ts) — the public barrel; every consumer imports from `forward-core`, so a new export must be re-exported here.

## Workflow

1. **Edit the Zod schema** in the relevant `*.ts` file. The Zod object is the source of
   truth — TS types are inferred from it (`z.infer`), so add the field to the schema, not a
   standalone interface. New fields that may be absent in existing RTDB data must be
   `.optional()` (or have a default) — old records won't have them.
2. **Update the sibling `*.test.ts`** in the same dir (these are colocated, e.g.
   [schema.test.ts](../../../packages/shared/src/schema.test.ts)). Cover the new/changed field.
3. **Re-export** from `index.ts` if you added a new symbol.
4. **Propagate to consumers** — grep before assuming nothing breaks:
   ```bash
   grep -rn "forward-core" apps/*/src | grep -i <symbol>
   ```
   - `apps/mcp/src/server.ts` imports many schema symbols directly and reuses
     `Foo.shape.bar` for tool input schemas — a renamed/removed field breaks it.
   - `apps/canvas` and `apps/extension` render/edit these objects in their webviews.
5. **Verify from the repo root** (workspace-aware):
   ```bash
   npm run build       # build shared first so apps see new types
   npm test            # all 63+ Vitest unit tests across workspaces
   npm run typecheck
   ```
   If only iterating on shared: `npm test -w packages/shared`.

## Gotchas

- The locked Firebase security rules in [apps/canvas/firebase.rules.json](../../../apps/canvas/firebase.rules.json) validate the on-disk shape per project subtree (`design_elements`, `version_timeline`, `infra_nodes`, `infra_edges`, `infra_flows`). A required new field can be rejected by the rules — keep additive changes optional, and update the rules if you tighten validation.
- Don't fork types in an app to "fix" a build — fix it in shared and rebuild.

## Troubleshooting

- **An app's typecheck fails after the schema edit.** Cause: you didn't rebuild shared, so the app still sees the old `.d.ts`. Solution: `npm run build -w packages/shared` (or root `npm run build`) before typechecking the apps.
- **A new symbol isn't importable from `forward-core`.** Cause: not re-exported. Solution: add it to [packages/shared/src/index.ts](../../../packages/shared/src/index.ts).
- **Writes succeed locally (fixture/mock) but fail against live Firebase.** Cause: the locked rules rejected the new shape. Solution: make the field optional or update [firebase.rules.json](../../../apps/canvas/firebase.rules.json) and `npm run deploy:rules`.
