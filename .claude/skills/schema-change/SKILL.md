---
name: schema-change
description: Propagates a change to the Forward shared data contract (Zod schemas + inferred TS types in packages/shared — schema.ts, infra-flow.ts, timeline.ts, api-rest.ts) across the canvas, VS Code extension, and MCP server so they stay in sync. Use when editing the design/binding tree or infra/timeline types — e.g. "add a field to DesignElement", "change the apiBinding shape", "new infra-node type", "edit forward-core", "the contract". Do NOT use for app-only UI/styling changes that don't touch packages/shared.
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
- [packages/shared/src/api-rest.ts](../../../packages/shared/src/api-rest.ts) — the central-server client (`forward-core/api`) that every surface uses.
- [packages/shared/src/index.ts](../../../packages/shared/src/index.ts) — the public barrel; every consumer imports from `forward-core`, so a new export must be re-exported here.

## Workflow

1. **Edit the Zod schema** in the relevant `*.ts` file. The Zod object is the source of
   truth — TS types are inferred from it (`z.infer`), so add the field to the schema, not a
   standalone interface. New fields that may be absent in existing data must be
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

- The server re-validates every write with the same `forward-core` Zod schemas. A required new field can be rejected on existing records — keep additive changes optional (or give them a default).
- Don't fork types in an app to "fix" a build — fix it in shared and rebuild.

## Troubleshooting

- **An app's typecheck fails after the schema edit.** Cause: you didn't rebuild shared, so the app still sees the old `.d.ts`. Solution: `npm run build -w packages/shared` (or root `npm run build`) before typechecking the apps.
- **A new symbol isn't importable from `forward-core`.** Cause: not re-exported. Solution: add it to [packages/shared/src/index.ts](../../../packages/shared/src/index.ts).
- **Writes succeed against a fixture/mock but fail against the live server.** Cause: the server's Zod re-validation rejected the new shape. Solution: make the field optional (or give it a default) so old and new payloads both parse.
